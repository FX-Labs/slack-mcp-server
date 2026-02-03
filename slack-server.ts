import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SlackClient } from './slack-client.js'
import { stripChannel, stripMessage, stripUser, stripSearchMatch, stripBookmark } from './strip-response.js'

/**
 * Wrap response data as MCP tool result content
 *
 * @param response - Data to serialize as JSON text content
 * @returns MCP tool result with text content
 */
function formatResponse( response: any ) {
	return {
		content: [
			{
				type: 'text' as const,
				text: JSON.stringify( response ),
			},
		],
	}
}

/**
 * Create MCP server with Slack tools registered
 *
 * @param slackClient - SlackClient instance for API calls
 * @returns Configured McpServer with all tools
 */
export function createSlackServer( slackClient: SlackClient ): McpServer {
	const server = new McpServer({
		name: 'Slack MCP Server',
		version: '1.0.0',
	})

	server.registerTool(
		'slack_get_team',
		{
			title: 'Get Team',
			description: 'Get information about the workspace the token is authenticated against. Use this to verify which team you are connected to',
			inputSchema: {},
		},
		async () => {
			const response = await slackClient.getTeam()

			return formatResponse( response )
		},
	)

	server.registerTool(
		'slack_get_channels',
		{
			title: 'Get Channels',
			description: 'List public and private channels in workspace with pagination. Use this to discover channel IDs before reading or posting messages',
			inputSchema: {
				limit: z.number().optional().default( 100 ).describe( 'Maximum number of channels to return (default 100, max 200)' ),
				cursor: z.string().optional().describe( 'Pagination cursor for next page of results' ),
				team_id: z.string().optional().describe( 'Team/workspace ID — use slack_get_team to find this (required for Enterprise Grid)' ),
			},
		},
		async ({ limit, cursor, team_id }) => {
			const response = await slackClient.getChannels( limit, cursor, team_id )

			return formatResponse({
				channels: response.channels?.map( stripChannel ),
				next_cursor: response.response_metadata?.next_cursor,
			})
		},
	)

	server.registerTool(
		'slack_post_message',
		{
			title: 'Post Message',
			description: 'Post message to Slack channel or direct message conversation. Provide either channel_id or user_id — if user_id is provided, a DM conversation will be opened automatically',
			inputSchema: {
				channel_id: z.string().optional().describe( 'Channel or conversation ID to post to. Provide this or user_id, not both' ),
				user_id: z.string().optional().describe( 'User ID to send a direct message to. Provide this or channel_id, not both' ),
				text: z.string().describe( 'Message text to post' ),
			},
		},
		async ({ channel_id, user_id, text }) => {
			const response = await slackClient.postMessage( channel_id, text, user_id )

			return formatResponse( response )
		},
	)

	server.registerTool(
		'slack_reply_to_message',
		{
			title: 'Reply to Message',
			description: 'Reply to specific message thread. Requires thread_ts (parent message timestamp) and either channel_id or user_id',
			inputSchema: {
				channel_id: z.string().optional().describe( 'Channel ID containing the thread. Provide this or user_id, not both' ),
				user_id: z.string().optional().describe( 'User ID for a DM thread. Provide this or channel_id, not both' ),
				thread_ts: z.string().describe( 'Parent message timestamp in format 1234567890.123456 — this is the message ID that starts the thread' ),
				text: z.string().describe( 'Reply text' ),
			},
		},
		async ({ channel_id, user_id, thread_ts, text }) => {
			const response = await slackClient.postReply( channel_id, thread_ts, text, user_id )

			return formatResponse( response )
		},
	)

	server.registerTool(
		'slack_add_reaction_to_message',
		{
			title: 'Add Reaction to Message',
			description: 'Add emoji reaction to message. Requires channel_id and message timestamp from slack_get_channel_messages or slack_get_message_replies',
			inputSchema: {
				channel_id: z.string().describe( 'Channel ID containing the message' ),
				timestamp: z.string().describe( 'Message timestamp (ID) to react to' ),
				reaction: z.string().describe( 'Emoji name without colons, e.g. thumbsup' ),
			},
		},
		async ({ channel_id, timestamp, reaction }) => {
			const response = await slackClient.addReaction( channel_id, timestamp, reaction )

			return formatResponse( response )
		},
	)

	server.registerTool(
		'slack_get_channel_messages',
		{
			title: 'Get Channel Messages',
			description: 'Retrieve recent messages from channel including their timestamps for use with reply and reaction tools',
			inputSchema: {
				channel_id: z.string().describe( 'Channel ID to retrieve messages from' ),
				limit: z.number().optional().default( 10 ).describe( 'Number of messages to retrieve (default 10)' ),
			},
		},
		async ({ channel_id, limit }) => {
			const response = await slackClient.getChannelHistory( channel_id, limit )
			const messages = await slackClient.enrichMessages( response.messages || [] )

			return formatResponse({
				messages: messages.map( stripMessage ),
				has_more: response.has_more,
			})
		},
	)

	server.registerTool(
		'slack_get_message_replies',
		{
			title: 'Get Message Replies',
			description: 'Retrieve all replies in message thread. Requires channel_id and thread_ts (parent message timestamp) from slack_get_channel_messages',
			inputSchema: {
				channel_id: z.string().describe( 'Channel ID containing the thread' ),
				thread_ts: z.string().describe( 'Parent message timestamp in format 1234567890.123456 — this is the message ID that starts the thread' ),
			},
		},
		async ({ channel_id, thread_ts }) => {
			const response = await slackClient.getThreadReplies( channel_id, thread_ts )
			const messages = await slackClient.enrichMessages( response.messages || [] )

			return formatResponse({
				messages: messages.map( stripMessage ),
				has_more: response.has_more,
			})
		},
	)

	server.registerTool(
		'slack_get_users',
		{
			title: 'List Users',
			description: 'List workspace members with basic profile info. Use this to discover user IDs before viewing profiles or sending direct messages',
			inputSchema: {
				cursor: z.string().optional().describe( 'Pagination cursor for next page of results' ),
				limit: z.number().optional().default( 100 ).describe( 'Maximum number of users to return (default 100, max 200)' ),
				team_id: z.string().optional().describe( 'Team/workspace ID — use slack_get_team to find this (required for Enterprise Grid)' ),
			},
		},
		async ({ cursor, limit, team_id }) => {
			const response = await slackClient.getUsers( limit, cursor, team_id )

			return formatResponse({
				members: response.members?.map( stripUser ),
				next_cursor: response.response_metadata?.next_cursor,
			})
		},
	)

	server.registerTool(
		'slack_search_messages',
		{
			title: 'Search Messages',
			description: 'Search messages across channels and conversations. Supports Slack search syntax like "in:#channel", "from:@user", "has:link", "before:2024-01-01", "after:2024-01-01"',
			inputSchema: {
				query: z.string().describe( 'Search query — supports Slack search modifiers like in:#channel, from:@user, has:link, before:YYYY-MM-DD, after:YYYY-MM-DD' ),
				count: z.number().optional().default( 20 ).describe( 'Number of results to return (default 20, max 100)' ),
				cursor: z.string().optional().describe( 'Pagination cursor for next page of results' ),
				sort: z.enum( [ 'timestamp', 'score' ] ).optional().default( 'timestamp' ).describe( 'Sort order — timestamp for recent first, score for most relevant first (default timestamp)' ),
				sort_dir: z.enum( [ 'asc', 'desc' ] ).optional().default( 'desc' ).describe( 'Sort direction (default desc)' ),
				team_id: z.string().optional().describe( 'Team/workspace ID — use slack_get_team to find this (required for Enterprise Grid)' ),
			},
		},
		async ({ query, count, cursor, sort, sort_dir, team_id }) => {
			const response = await slackClient.searchMessages( query, count, cursor, sort, sort_dir, team_id )
			const matches = await slackClient.enrichMessages( response.messages?.matches || [] )

			return formatResponse({
				total: response.messages?.total,
				matches: matches.map( stripSearchMatch ),
			})
		},
	)

	server.registerTool(
		'slack_get_user',
		{
			title: 'Get User',
			description: 'Get detailed profile for specific user. Requires user_id from slack_get_users',
			inputSchema: {
				user_id: z.string().describe( 'User ID to retrieve profile for' ),
			},
		},
		async ({ user_id }) => {
			const response = await slackClient.getUserProfile( user_id )
			const profile = response.profile

			return formatResponse({
				profile: {
					title: profile?.title,
					display_name: profile?.display_name,
					real_name: profile?.real_name,
					email: profile?.email,
					phone: profile?.phone,
					first_name: profile?.first_name,
					last_name: profile?.last_name,
					status_text: profile?.status_text,
				},
			})
		},
	)

	server.registerTool(
		'slack_get_bookmarks',
		{
			title: 'Get Bookmarks',
			description: 'Get bookmarks in a channel',
			inputSchema: {
				channel_id: z.string().describe( 'Channel ID to get bookmarks from' ),
			},
		},
		async ({ channel_id }) => {
			const response = await slackClient.getBookmarks( channel_id )

			return formatResponse({
				bookmarks: response.bookmarks?.map( stripBookmark ),
			})
		},
	)

	server.registerTool(
		'slack_add_bookmark',
		{
			title: 'Add Bookmark',
			description: 'Add a bookmark to a channel',
			inputSchema: {
				channel_id: z.string().describe( 'Channel ID to add bookmark to' ),
				title: z.string().describe( 'Bookmark title' ),
				type: z.string().optional().default( 'link' ).describe( 'Bookmark type (default "link")' ),
				link: z.string().optional().describe( 'URL for the bookmark' ),
				emoji: z.string().optional().describe( 'Emoji icon for the bookmark' ),
			},
		},
		async ({ channel_id, title, type, link, emoji }) => {
			const response = await slackClient.addBookmark( channel_id, title, type, link, emoji )

			return formatResponse( response )
		},
	)

	server.registerTool(
		'slack_get_pins',
		{
			title: 'Get Pins',
			description: 'Get pinned messages in a channel',
			inputSchema: {
				channel_id: z.string().describe( 'Channel ID to get pinned messages from' ),
			},
		},
		async ({ channel_id }) => {
			const response = await slackClient.getPins( channel_id )

			const items = response.items || []
			const messages = items
				.filter( ( item: any ) => item.message )
				.map( ( item: any ) => item.message )

			const enriched = await slackClient.enrichMessages( messages )

			return formatResponse({
				pins: enriched.map( stripMessage ),
			})
		},
	)

	server.registerTool(
		'slack_add_pin',
		{
			title: 'Add Pin',
			description: 'Pin a message in a channel',
			inputSchema: {
				channel_id: z.string().describe( 'Channel ID containing the message' ),
				timestamp: z.string().describe( 'Message timestamp (ID) to pin' ),
			},
		},
		async ({ channel_id, timestamp }) => {
			const response = await slackClient.addPin( channel_id, timestamp )

			return formatResponse( response )
		},
	)

	server.registerTool(
		'slack_get_reminders',
		{
			title: 'Get Reminders',
			description: 'Get your reminders',
			inputSchema: {
				team_id: z.string().optional().describe( 'Team/workspace ID — use slack_get_team to find this (required for Enterprise Grid)' ),
			},
		},
		async ({ team_id }) => {
			const response = await slackClient.getReminders( team_id )

			return formatResponse({
				reminders: response.reminders,
			})
		},
	)

	server.registerTool(
		'slack_add_reminder',
		{
			title: 'Add Reminder',
			description: 'Create a reminder',
			inputSchema: {
				text: z.string().describe( 'Reminder text' ),
				time: z.string().describe( 'When to remind — Unix timestamp or natural language like "in 15 minutes", "every Thursday"' ),
				user: z.string().optional().describe( 'User ID to remind (defaults to yourself)' ),
				team_id: z.string().optional().describe( 'Team/workspace ID — use slack_get_team to find this (required for Enterprise Grid)' ),
			},
		},
		async ({ text, time, user, team_id }) => {
			const response = await slackClient.addReminder( text, time, user, team_id )

			return formatResponse( response )
		},
	)

	server.registerTool(
		'slack_get_unreads',
		{
			title: 'Get Unreads',
			description: 'Get channels and DMs with unread messages',
			inputSchema: {
				team_id: z.string().optional().describe( 'Team/workspace ID — use slack_get_team to find this (required for Enterprise Grid)' ),
			},
		},
		async ({ team_id }) => {
			const unreads = await slackClient.getUnreadChannels( team_id )

			return formatResponse({
				unreads: unreads,
			})
		},
	)

	return server
}
