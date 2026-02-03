export class SlackClient {
	private botHeaders: { Authorization: string; 'Content-Type': string }
	private userCache: Map<string, any> = new Map()

	constructor( token: string ) {
		this.botHeaders = {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		}
	}

	/**
	 * Fetch single user by ID with session-scoped caching
	 *
	 * @param user_id - Slack user ID to look up
	 * @returns Stripped user object with id, name, display_name
	 */
	private async getUser( user_id: string ): Promise<any> {
		const cached = this.userCache.get( user_id )

		if ( cached ) {
			return cached
		}

		const params = new URLSearchParams({ user: user_id })
		const response = await fetch(
			`https://slack.com/api/users.info?${params}`,
			{ headers: this.botHeaders },
		)
		const data = await response.json()

		if ( data.ok && data.user ) {
			const stripped = {
				id: data.user.id,
				name: data.user.name,
				display_name: data.user.profile?.display_name,
			}

			this.userCache.set( user_id, stripped )

			return stripped
		}

		return { id: user_id }
	}

	/**
	 * Resolve user IDs to user objects on messages and reactions
	 *
	 * @param messages - Raw Slack message objects
	 * @returns Messages with user IDs replaced by user objects
	 */
	async enrichMessages( messages: any[] ): Promise<any[]> {
		const messageUserIds = messages
			.map( ( m: any ) => m.user )
			.filter( Boolean )

		const reactionUserIds = messages
			.flatMap( ( m: any ) => m.reactions || [] )
			.flatMap( ( r: any ) => r.users || [] )

		const allUserIds = [ ...new Set( [ ...messageUserIds, ...reactionUserIds ] ) ]
		await Promise.all( allUserIds.map( id => this.getUser( id ) ) )

		return messages.map( message => ({
			...message,
			user: message.user ? this.userCache.get( message.user ) || { id: message.user } : undefined,
			reactions: message.reactions?.map( ( reaction: any ) => ({
				...reaction,
				users: reaction.users?.map( ( id: any ) =>
					this.userCache.get( id ) || { id },
				),
			}) ),
		}) )
	}

	/**
	 * List public and private channels in workspace
	 *
	 * @param limit - Max channels to return (default 100, max 200)
	 * @param cursor - Pagination cursor for next page
	 * @returns Slack conversations.list response
	 */
	async getChannels( limit: number = 100, cursor?: string ): Promise<any> {
		const params = new URLSearchParams({
			exclude_archived: 'true',
			types: 'public_channel,private_channel',
			limit: Math.min( limit, 200 ).toString(),
		})

		if ( cursor ) {
			params.append( 'cursor', cursor )
		}

		const response = await fetch(
			`https://slack.com/api/conversations.list?${params}`,
			{ headers: this.botHeaders },
		)

		return response.json()
	}

	/**
	 * Post message to channel or DM conversation
	 *
	 * @param channel_id - Channel or conversation ID
	 * @param text - Message text to post
	 * @returns Slack chat.postMessage response
	 */
	async postMessage( channel_id: string, text: string ): Promise<any> {
		const response = await fetch( 'https://slack.com/api/chat.postMessage', {
			method: 'POST',
			headers: this.botHeaders,
			body: JSON.stringify({
				channel: channel_id,
				text: text,
			}),
		})

		return response.json()
	}

	/**
	 * Post reply to message thread
	 *
	 * @param channel_id - Channel ID containing thread
	 * @param thread_ts - Parent message timestamp
	 * @param text - Reply text
	 * @returns Slack chat.postMessage response
	 */
	async postReply(
		channel_id: string,
		thread_ts: string,
		text: string,
	): Promise<any> {
		const response = await fetch( 'https://slack.com/api/chat.postMessage', {
			method: 'POST',
			headers: this.botHeaders,
			body: JSON.stringify({
				channel: channel_id,
				thread_ts: thread_ts,
				text: text,
			}),
		})

		return response.json()
	}

	/**
	 * Add emoji reaction to message
	 *
	 * @param channel_id - Channel ID containing message
	 * @param timestamp - Message timestamp to react to
	 * @param reaction - Emoji name without colons
	 * @returns Slack reactions.add response
	 */
	async addReaction(
		channel_id: string,
		timestamp: string,
		reaction: string,
	): Promise<any> {
		const response = await fetch( 'https://slack.com/api/reactions.add', {
			method: 'POST',
			headers: this.botHeaders,
			body: JSON.stringify({
				channel: channel_id,
				timestamp: timestamp,
				name: reaction,
			}),
		})

		return response.json()
	}

	/**
	 * Retrieve recent messages from channel
	 *
	 * @param channel_id - Channel ID to fetch history from
	 * @param limit - Number of messages to retrieve (default 10)
	 * @returns Slack conversations.history response
	 */
	async getChannelHistory(
		channel_id: string,
		limit: number = 10,
	): Promise<any> {
		const params = new URLSearchParams({
			channel: channel_id,
			limit: limit.toString(),
		})

		const response = await fetch(
			`https://slack.com/api/conversations.history?${params}`,
			{ headers: this.botHeaders },
		)

		return response.json()
	}

	/**
	 * Retrieve all replies in message thread
	 *
	 * @param channel_id - Channel ID containing thread
	 * @param thread_ts - Parent message timestamp
	 * @returns Slack conversations.replies response
	 */
	async getThreadReplies( channel_id: string, thread_ts: string ): Promise<any> {
		const params = new URLSearchParams({
			channel: channel_id,
			ts: thread_ts,
		})

		const response = await fetch(
			`https://slack.com/api/conversations.replies?${params}`,
			{ headers: this.botHeaders },
		)

		return response.json()
	}

	/**
	 * List workspace members with basic profile info
	 *
	 * @param limit - Max users to return (default 100, max 200)
	 * @param cursor - Pagination cursor for next page
	 * @returns Slack users.list response
	 */
	async getUsers( limit: number = 100, cursor?: string ): Promise<any> {
		const params = new URLSearchParams({
			limit: Math.min( limit, 200 ).toString(),
		})

		if ( cursor ) {
			params.append( 'cursor', cursor )
		}

		const response = await fetch( `https://slack.com/api/users.list?${params}`, {
			headers: this.botHeaders,
		})

		return response.json()
	}

	/**
	 * Search messages across channels and conversations
	 *
	 * @param query - Search query with optional Slack modifiers
	 * @param count - Number of results to return (default 20)
	 * @param cursor - Pagination cursor for next page
	 * @param sort - Sort by timestamp or score (default timestamp)
	 * @param sort_dir - Sort direction asc or desc (default desc)
	 * @returns Slack search.messages response
	 */
	async searchMessages(
		query: string,
		count: number = 20,
		cursor?: string,
		sort: string = 'timestamp',
		sort_dir: string = 'desc',
	): Promise<any> {
		const params = new URLSearchParams({
			query: query,
			count: count.toString(),
			sort: sort,
			sort_dir: sort_dir,
		})

		if ( cursor ) {
			params.append( 'cursor', cursor )
		}

		const response = await fetch(
			`https://slack.com/api/search.messages?${params}`,
			{ headers: this.botHeaders },
		)

		return response.json()
	}

	/**
	 * Open or resume DM/group DM conversation
	 *
	 * @param users - Comma-separated user IDs
	 * @returns Slack conversations.open response
	 */
	async openConversation( users: string ): Promise<any> {
		const response = await fetch( 'https://slack.com/api/conversations.open', {
			method: 'POST',
			headers: this.botHeaders,
			body: JSON.stringify({
				users: users,
			}),
		})

		return response.json()
	}

	/**
	 * Fetch detailed profile for specific user
	 *
	 * @param user_id - Slack user ID
	 * @returns Slack users.profile.get response
	 */
	async getUserProfile( user_id: string ): Promise<any> {
		const params = new URLSearchParams({
			user: user_id,
			include_labels: 'true',
		})

		const response = await fetch(
			`https://slack.com/api/users.profile.get?${params}`,
			{ headers: this.botHeaders },
		)

		return response.json()
	}
}
