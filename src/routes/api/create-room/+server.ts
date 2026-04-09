import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { RoomServiceClient } from 'livekit-server-sdk';
import { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } from '$env/static/private';
import { nanoid } from 'nanoid';

export const POST: RequestHandler = async () => {
	const roomId = nanoid(10);

	const roomService = new RoomServiceClient(
		LIVEKIT_URL.replace('wss://', 'https://'),
		LIVEKIT_API_KEY,
		LIVEKIT_API_SECRET
	);

	try {
		await roomService.createRoom({
			name: roomId,
			maxParticipants: 6,
			emptyTimeout: 60 * 10, // 10 min empty → destroy
		});

		return json({ roomId });
	} catch (e) {
		console.error('Error creating room:', e);
		return json({ error: 'No se pudo crear la sala' }, { status: 500 });
	}
};
