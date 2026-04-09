import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AccessToken } from 'livekit-server-sdk';
import { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	const { roomId, participantName, role } = await request.json();

	if (!roomId || !participantName) {
		return json({ error: 'roomId y participantName son obligatorios' }, { status: 400 });
	}

	const isMaster = role === 'master';

	const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
		identity: `${participantName}-${Date.now()}`,
		name: participantName,
	});

	token.addGrant({
		roomJoin: true,
		room: roomId,
		canPublish: true,
		canSubscribe: true,
		canPublishData: true,
		canPublishSources: isMaster
			? ['camera', 'microphone', 'screen_share', 'screen_share_audio']
			: ['camera', 'microphone'],
		roomAdmin: isMaster,
	});

	const jwt = await token.toJwt();

	return json({ token: jwt });
};
