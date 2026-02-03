/**
 * Strip channel object to essential fields
 *
 * @param channel - Raw Slack channel object
 * @returns Stripped channel with id, name, topic, purpose, membership info
 */
export function stripChannel( channel: any ) {
	return {
		id: channel.id,
		name: channel.name,
		topic: channel.topic?.value,
		purpose: channel.purpose?.value,
		member_count: channel.num_members,
		is_private: channel.is_private,
		is_member: channel.is_member,
		is_archived: channel.is_archived,
	}
}

/**
 * Strip message object to essential fields with thread indicators
 *
 * @param message - Raw Slack message object
 * @returns Stripped message with ts, user, text, thread/reply flags
 */
export function stripMessage( message: any ) {
	const stripped: any = {
		ts: message.ts,
		user: message.user,
		text: message.text,
	}

	if ( message.thread_ts ) {
		stripped.thread_ts = message.thread_ts
	}

	if ( message.reply_count ) {
		stripped.reply_count = message.reply_count
	}

	if ( message.reactions ) {
		stripped.reactions = message.reactions
	}

	if ( message.subtype ) {
		stripped.subtype = message.subtype
	}

	if ( message.thread_ts ) {
		if ( message.thread_ts === message.ts ) {
			stripped.is_parent_message = true
		} else {
			stripped.is_reply = true
		}
	}

	if ( message.permalink ) {
		stripped.permalink = message.permalink
	}

	return stripped
}

/**
 * Strip user object to essential fields with profile subset
 *
 * @param user - Raw Slack user object
 * @returns Stripped user with id, name, real_name, profile basics
 */
export function stripUser( user: any ) {
	return {
		id: user.id,
		name: user.name,
		real_name: user.real_name,
		deleted: user.deleted,
		is_bot: user.is_bot,
		profile: {
			title: user.profile?.title,
			display_name: user.profile?.display_name,
			email: user.profile?.email,
			first_name: user.profile?.first_name,
			last_name: user.profile?.last_name,
		},
	}
}

/**
 * Strip search match to essential fields with reply detection
 *
 * @param match - Raw Slack search match object
 * @returns Stripped match with message fields, channel info, is_reply flag
 */
export function stripSearchMatch( match: any ) {
	const threadTsRegex = /thread_ts=([0-9.]+)/
	const threadTs = match.thread_ts
		|| match.permalink?.match( threadTsRegex )?.[1]
	const isReply = threadTs && threadTs !== match.ts

	const stripped: any = {
		...stripMessage( match ),
		channel: {
			id: match.channel?.id,
			name: match.channel?.name,
			is_private: match.channel?.is_private,
		},
		permalink: match.permalink,
	}

	if ( isReply ) {
		stripped.is_reply = true
	}

	if ( threadTs ) {
		stripped.thread_ts = threadTs
	}

	return stripped
}

/**
 * Strip bookmark object to essential fields
 *
 * @param bookmark - Raw Slack bookmark object
 * @returns Stripped bookmark with id, title, type, link, emoji, date_created
 */
export function stripBookmark( bookmark: any ) {
	return {
		id: bookmark.id,
		title: bookmark.title,
		type: bookmark.type,
		link: bookmark.link,
		emoji: bookmark.emoji,
		date_created: bookmark.date_created,
	}
}
