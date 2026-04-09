import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { RoomServiceClient } from 'livekit-server-sdk';
import { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } from '$env/static/private';
import { nanoid } from 'nanoid';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const requestedRoomId = body.roomId;
	
	// Si se proporciona un roomId, usarlo; si no, generar uno nuevo
	const roomId = requestedRoomId || nanoid(10);

	const roomService = new RoomServiceClient(
		LIVEKIT_URL.replace('wss://', 'https://'),
		LIVEKIT_API_KEY,
		LIVEKIT_API_SECRET
	);

	try {
		// Intentar crear la sala
		await roomService.createRoom({
			name: roomId,
			maxParticipants: 6,
			emptyTimeout: 60 * 10, // 10 min empty → destroy
		});

		return json({ roomId, isNew: true });
	} catch (e: any) {
		// Si la sala ya existe, verificar que esté accesible
		if (e.message?.includes('already exists') || e.code === 409) {
			try {
				// Verificar que la sala existe y está disponible
				const room = await roomService.listRooms([roomId]);
				if (room.length > 0) {
					return json({ roomId, isNew: false });
				}
			} catch (listError) {
				console.error('Error listing room:', listError);
			}
		}
		
		console.error('Error creating room:', e);
		return json({ error: 'No se pudo crear la sala' }, { status: 500 });
	}
};
