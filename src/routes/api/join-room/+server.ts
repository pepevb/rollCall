import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Cuerpo de la petición inválido' }, { status: 400 });
	}

	const { roomId, participantName, role } = body as Record<string, unknown>;

	if (!roomId || typeof roomId !== 'string' || !roomId.trim()) {
		return json({ error: 'El identificador de sala es obligatorio' }, { status: 400 });
	}
	if (!participantName || typeof participantName !== 'string' || !participantName.trim()) {
		return json({ error: 'El nombre del participante es obligatorio' }, { status: 400 });
	}

	const isMaster = role === 'master';

	try {
		const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
			identity: `${participantName.trim()}-${Date.now()}`,
			name: participantName.trim(),
		});

		token.addGrant({
			roomJoin: true,
			room: roomId.trim(),
			canPublish: true,
			canSubscribe: true,
			canPublishData: true,
			canPublishSources: isMaster
				? [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
				: [TrackSource.CAMERA, TrackSource.MICROPHONE],
			roomAdmin: isMaster,
		});

		const jwt = await token.toJwt();

		return json({ token: jwt });
	} catch (e) {
		console.error('Error minting token:', e);
		return json({ error: 'No se pudo generar el token de acceso' }, { status: 500 });
	}
};
