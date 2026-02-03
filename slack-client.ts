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
	 * Get workspaces the token has access to
	 *
	 * @returns auth.teams.list response with team objects
	 */
	async getTeam(): Promise<any> {
		const response = await fetch(
			'https://slack.com/api/auth.teams.list',
			{ headers: this.botHeaders },
		)

		return response.json()
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
	 * Resolve channel_id or user_id to a channel ID
	 *
	 * @param channel_id - Channel or conversation ID (used directly if provided)
	 * @param user_id - User ID to open a DM with (resolved via conversations.open)
	 * @returns Resolved channel ID
	 */
	private async resolveChannel( channel_id?: string, user_id?: string ): Promise<string> {
		if ( channel_id ) {
			return channel_id
		}

		if ( user_id ) {
			const response = await fetch( 'https://slack.com/api/conversations.open', {
				method: 'POST',
				headers: this.botHeaders,
				body: JSON.stringify({
					users: user_id,
				}),
			})
			const data = await response.json()

			if ( data.ok && data.channel?.id ) {
				return data.channel.id
			}

			throw new Error( `Failed to open DM with user ${user_id}: ${data.error || 'unknown error'}` )
		}

		throw new Error( 'Either channel_id or user_id must be provided' )
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
	async getChannels( limit: number = 100, cursor?: string, team_id?: string ): Promise<any> {
		const params = new URLSearchParams({
			exclude_archived: 'true',
			types: 'public_channel,private_channel',
			limit: Math.min( limit, 200 ).toString(),
		})

		if ( cursor ) {
			params.append( 'cursor', cursor )
		}

		if ( team_id ) {
			params.append( 'team_id', team_id )
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
	 * @param channel_id - Channel or conversation ID (optional if user_id provided)
	 * @param text - Message text to post
	 * @param user_id - User ID to DM (optional if channel_id provided)
	 * @returns Slack chat.postMessage response
	 */
	async postMessage( channel_id: string | undefined, text: string, user_id?: string ): Promise<any> {
		const resolved = await this.resolveChannel( channel_id, user_id )

		const response = await fetch( 'https://slack.com/api/chat.postMessage', {
			method: 'POST',
			headers: this.botHeaders,
			body: JSON.stringify({
				channel: resolved,
				text: text,
			}),
		})

		return response.json()
	}

	/**
	 * Post reply to message thread
	 *
	 * @param channel_id - Channel ID containing thread (optional if user_id provided)
	 * @param thread_ts - Parent message timestamp
	 * @param text - Reply text
	 * @param user_id - User ID to DM (optional if channel_id provided)
	 * @returns Slack chat.postMessage response
	 */
	async postReply(
		channel_id: string | undefined,
		thread_ts: string,
		text: string,
		user_id?: string,
	): Promise<any> {
		const resolved = await this.resolveChannel( channel_id, user_id )

		const response = await fetch( 'https://slack.com/api/chat.postMessage', {
			method: 'POST',
			headers: this.botHeaders,
			body: JSON.stringify({
				channel: resolved,
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
	async getUsers( limit: number = 100, cursor?: string, team_id?: string ): Promise<any> {
		const params = new URLSearchParams({
			limit: Math.min( limit, 200 ).toString(),
		})

		if ( cursor ) {
			params.append( 'cursor', cursor )
		}

		if ( team_id ) {
			params.append( 'team_id', team_id )
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
		team_id?: string,
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

		if ( team_id ) {
			params.append( 'team_id', team_id )
		}

		const response = await fetch(
			`https://slack.com/api/search.messages?${params}`,
			{ headers: this.botHeaders },
		)

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

	/**
	 * Get bookmarks in a channel
	 *
	 * @param channel_id - Channel ID to get bookmarks from
	 * @returns Slack bookmarks.list response
	 */
	async getBookmarks( channel_id: string ): Promise<any> {
		const params = new URLSearchParams({
			channel_id: channel_id,
		})

		const response = await fetch(
			`https://slack.com/api/bookmarks.list?${params}`,
			{ headers: this.botHeaders },
		)

		return response.json()
	}

	/**
	 * Add a bookmark to a channel
	 *
	 * @param channel_id - Channel ID to add bookmark to
	 * @param title - Bookmark title
	 * @param type - Bookmark type (e.g. "link")
	 * @param link - URL for the bookmark
	 * @param emoji - Emoji icon for the bookmark
	 * @returns Slack bookmarks.add response
	 */
	async addBookmark(
		channel_id: string,
		title: string,
		type: string,
		link?: string,
		emoji?: string,
	): Promise<any> {
		const body: any = {
			channel_id: channel_id,
			title: title,
			type: type,
		}

		if ( link ) {
			body.link = link
		}

		if ( emoji ) {
			body.emoji = emoji
		}

		const response = await fetch( 'https://slack.com/api/bookmarks.add', {
			method: 'POST',
			headers: this.botHeaders,
			body: JSON.stringify( body ),
		})

		return response.json()
	}

	/**
	 * Get pinned messages in a channel
	 *
	 * @param channel_id - Channel ID to get pins from
	 * @returns Slack pins.list response
	 */
	async getPins( channel_id: string ): Promise<any> {
		const params = new URLSearchParams({
			channel: channel_id,
		})

		const response = await fetch(
			`https://slack.com/api/pins.list?${params}`,
			{ headers: this.botHeaders },
		)

		return response.json()
	}

	/**
	 * Pin a message in a channel
	 *
	 * @param channel_id - Channel ID containing the message
	 * @param timestamp - Message timestamp to pin
	 * @returns Slack pins.add response
	 */
	async addPin( channel_id: string, timestamp: string ): Promise<any> {
		const response = await fetch( 'https://slack.com/api/pins.add', {
			method: 'POST',
			headers: this.botHeaders,
			body: JSON.stringify({
				channel: channel_id,
				timestamp: timestamp,
			}),
		})

		return response.json()
	}

	/**
	 * Get reminders for the authenticated user
	 *
	 * @returns Slack reminders.list response
	 */
	async getReminders( team_id?: string ): Promise<any> {
		const params = new URLSearchParams()

		if ( team_id ) {
			params.append( 'team_id', team_id )
		}

		const response = await fetch(
			`https://slack.com/api/reminders.list?${params}`,
			{ headers: this.botHeaders },
		)

		return response.json()
	}

	/**
	 * Create a reminder
	 *
	 * @param text - Reminder text
	 * @param time - When to remind (Unix timestamp or natural language)
	 * @param user - User ID to remind (optional, defaults to authenticated user)
	 * @returns Slack reminders.add response
	 */
	async addReminder( text: string, time: string, user?: string, team_id?: string ): Promise<any> {
		const body: any = {
			text: text,
			time: time,
		}

		if ( team_id ) {
			body.team_id = team_id
		}

		if ( user ) {
			body.user = user
		}

		const response = await fetch( 'https://slack.com/api/reminders.add', {
			method: 'POST',
			headers: this.botHeaders,
			body: JSON.stringify( body ),
		})

		return response.json()
	}

	/**
	 * Get channels and DMs with unread messages
	 *
	 * @returns Array of conversations with unread messages
	 */
	async getUnreadChannels( team_id?: string ): Promise<any[]> {
		const allChannels: any[] = []
		let cursor: string | undefined

		do {
			const params = new URLSearchParams({
				types: 'public_channel,private_channel,im,mpim',
				exclude_archived: 'true',
				unreads: 'true',
				limit: '200',
			})

			if ( cursor ) {
				params.append( 'cursor', cursor )
			}

			if ( team_id ) {
				params.append( 'team_id', team_id )
			}

			const response = await fetch(
				`https://slack.com/api/conversations.list?${params}`,
				{ headers: this.botHeaders },
			)
			const data = await response.json()

			if ( data.ok && data.channels ) {
				allChannels.push( ...data.channels )
			}

			cursor = data.response_metadata?.next_cursor || undefined
		} while ( cursor )

		const unread = allChannels.filter( ( c: any ) => 0 < c.unread_count_display )

		// Enrich DMs with user info
		const enriched = await Promise.all(
			unread.map( async ( c: any ) => {
				const result: any = {
					id: c.id,
					name: c.name,
					unread_count: c.unread_count_display,
					is_im: c.is_im || false,
					is_mpim: c.is_mpim || false,
					is_private: c.is_private || false,
				}

				if ( c.is_im && c.user ) {
					result.user = await this.getUser( c.user )
				}

				return result
			}),
		)

		return enriched
	}
}
