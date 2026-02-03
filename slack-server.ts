import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SlackClient } from './slack-client.js'
import { stripChannel, stripMessage, stripUser, stripSearchMatch } from './strip-response.js'

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
		'slack_list_channels',
		{
			title: 'List Channels',
			description: 'List public and private channels in workspace with pagination. Use this to discover channel IDs before reading or posting messages',
			inputSchema: {
				limit: z.number().optional().default( 100 ).describe( 'Maximum number of channels to return (default 100, max 200)' ),
				cursor: z.string().optional().describe( 'Pagination cursor for next page of results' ),
			},
		},
		async ({ limit, cursor }) => {
			const response = await slackClient.getChannels( limit, cursor )

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
			description: 'Post message to Slack channel or direct message conversation. Requires channel_id from slack_list_channels or slack_open_conversation',
			inputSchema: {
				channel_id: z.string().describe( 'Channel or conversation ID to post to' ),
				text: z.string().describe( 'Message text to post' ),
			},
		},
		async ({ channel_id, text }) => {
			const response = await slackClient.postMessage( channel_id, text )

			return formatResponse( response )
		},
	)

	server.registerTool(
		'slack_reply_to_thread',
		{
			title: 'Reply to Thread',
			description: 'Reply to specific message thread. Requires channel_id and thread_ts (parent message timestamp) from slack_get_channel_history',
			inputSchema: {
				channel_id: z.string().describe( 'Channel ID containing the thread' ),
				thread_ts: z.string().describe( 'Parent message timestamp in format 1234567890.123456 — this is the message ID that starts the thread' ),
				text: z.string().describe( 'Reply text' ),
			},
		},
		async ({ channel_id, thread_ts, text }) => {
			const response = await slackClient.postReply( channel_id, thread_ts, text )

			return formatResponse( response )
		},
	)

	server.registerTool(
		'slack_add_reaction',
		{
			title: 'Add Reaction',
			description: 'Add emoji reaction to message. Requires channel_id and message timestamp from slack_get_channel_history or slack_get_thread_replies',
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
		'slack_get_channel_history',
		{
			title: 'Get Channel History',
			description: 'Retrieve recent messages from channel including their timestamps for use with reply and reaction tools',
			inputSchema: {
				channel_id: z.string().describe( 'Channel ID to retrieve history from' ),
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
		'slack_get_thread_replies',
		{
			title: 'Get Thread Replies',
			description: 'Retrieve all replies in message thread. Requires channel_id and thread_ts (parent message timestamp) from slack_get_channel_history',
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
			description: 'List workspace members with basic profile info. Use this to discover user IDs before viewing profiles or opening conversations',
			inputSchema: {
				cursor: z.string().optional().describe( 'Pagination cursor for next page of results' ),
				limit: z.number().optional().default( 100 ).describe( 'Maximum number of users to return (default 100, max 200)' ),
			},
		},
		async ({ cursor, limit }) => {
			const response = await slackClient.getUsers( limit, cursor )

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
			},
		},
		async ({ query, count, cursor, sort, sort_dir }) => {
			const response = await slackClient.searchMessages( query, count, cursor, sort, sort_dir )
			const matches = await slackClient.enrichMessages( response.messages?.matches || [] )

			return formatResponse({
				total: response.messages?.total,
				matches: matches.map( stripSearchMatch ),
			})
		},
	)

	server.registerTool(
		'slack_open_conversation',
		{
			title: 'Open Conversation',
			description: 'Open or resume direct message conversation with one or more users. Returns channel_id for use with slack_post_message. Use slack_get_users to find user IDs first',
			inputSchema: {
				users: z.string().describe( 'Comma-separated user IDs — one for DM, multiple (up to 8) for group DM' ),
			},
		},
		async ({ users }) => {
			const response = await slackClient.openConversation( users )

			return formatResponse( response )
		},
	)

	server.registerTool(
		'slack_get_user_profile',
		{
			title: 'Get User Profile',
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

	return server
}
