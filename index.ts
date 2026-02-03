#!/usr/bin/env node
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { SlackClient } from './slack-client.js'
import { createSlackServer } from './slack-server.js'

/**
 * Start HTTP server with MCP transport and session management
 *
 * @param port - Port number to listen on
 * @returns Express HTTP server instance
 */
async function runHttpServer( port: number = 3000 ) {
	console.error( `Starting Slack MCP Server on port ${port}...` )

	const app = express()
	app.use( express.json() )

	// Map to store transports by session ID
	const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {}

	// Handle POST requests for client-to-server communication
	app.post( '/mcp', async ( req, res ) => {
		try {
			// Check for existing session ID
			const sessionId = req.headers['mcp-session-id'] as string | undefined
			let transport: StreamableHTTPServerTransport

			if ( sessionId && transports[sessionId] ) {
				// Reuse existing transport
				transport = transports[sessionId]
			} else if ( !sessionId && 'initialize' === req.body?.method ) {
				// Read Slack token from request header
				const slackToken = req.headers['x-slack-token'] as string | undefined
				if ( !slackToken ) {
					res.status( 401 ).json({
						jsonrpc: '2.0',
						error: {
							code: -32000,
							message: 'Unauthorized: Missing X-Slack-Token header',
						},
						id: null,
					})
					return
				}

				// Create a per-session Slack client with the user's token
				const sessionSlackClient = new SlackClient( slackToken )

				// New initialization request
				transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => randomUUID(),
					onsessioninitialized: sessionId => {
						// Store the transport by session ID
						transports[sessionId] = transport
					},
				})

				// Clean up transport when closed
				transport.onclose = () => {
					if ( transport.sessionId ) {
						delete transports[transport.sessionId]
					}
				}

				const server = createSlackServer( sessionSlackClient )
				await server.connect( transport )
			} else {
				res.status( 400 ).json({
					jsonrpc: '2.0',
					error: {
						code: -32000,
						message: 'Bad Request: No valid session ID provided',
					},
					id: null,
				})
				return
			}

			await transport.handleRequest( req, res, req.body )
		} catch ( error ) {
			console.error( 'Error handling MCP request:', error )
			if ( !res.headersSent ) {
				res.status( 500 ).json({
					jsonrpc: '2.0',
					error: {
						code: -32603,
						message: 'Internal server error',
					},
					id: null,
				})
			}
		}
	})

	// Reusable handler for GET and DELETE requests
	const handleSessionRequest = async ( req: express.Request, res: express.Response ) => {
		const sessionId = req.headers['mcp-session-id'] as string | undefined
		if ( !sessionId || !transports[sessionId] ) {
			res.status( 400 ).send( 'Invalid or missing session ID' )
			return
		}

		const transport = transports[sessionId]
		await transport.handleRequest( req, res )
	}

	// Handle GET requests for server-to-client notifications via Streamable HTTP
	app.get( '/mcp', handleSessionRequest )

	// Handle DELETE requests for session termination
	app.delete( '/mcp', handleSessionRequest )

	// Health endpoint
	app.get( '/health', ( req, res ) => {
		res.status( 200 ).json({
			status: 'healthy',
			timestamp: new Date().toISOString(),
			service: 'Slack MCP Server',
			version: '1.0.0',
		})
	})

	const server = app.listen( port, '0.0.0.0', () => {
		console.error( `Slack MCP Server running on http://0.0.0.0:${port}/mcp` )
	})

	return server
}

/**
 * Initialize server and register shutdown handlers
 *
 * @returns void
 */
async function main() {
	const port = parseInt( process.env.PORT || '3000', 10 )

	const httpServer = await runHttpServer( port )

	// Setup graceful shutdown handlers
	const shutdown = ( signal: string ) => {
		console.error( `\nReceived ${signal}. Shutting down gracefully...` )

		httpServer.close( () => {
			console.error( 'HTTP server closed.' )
			process.exit( 0 )
		})

		// Force close after 5 seconds
		setTimeout( () => {
			console.error( 'Forcing shutdown...' )
			process.exit( 1 )
		}, 5000 )
	}

	process.on( 'SIGINT', () => shutdown( 'SIGINT' ) )
	process.on( 'SIGTERM', () => shutdown( 'SIGTERM' ) )
	process.on( 'SIGQUIT', () => shutdown( 'SIGQUIT' ) )
}

main().catch( error => {
	console.error( 'Fatal error in main():', error )
	process.exit( 1 )
})
