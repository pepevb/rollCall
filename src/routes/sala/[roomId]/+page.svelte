<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { PUBLIC_LIVEKIT_URL } from '$env/static/public';
	import {
		Room,
		RoomEvent,
		Track,
		DisconnectReason,
		type RemoteParticipant,
		type RemoteTrack,
		type RemoteTrackPublication,
		type Participant,
	} from 'livekit-client';

	let roomId = $derived($page.params.roomId);
	let urlRole = $derived($page.url.searchParams.get('role'));
	let urlName = $derived($page.url.searchParams.get('name'));

	let isMaster = $state(false);
	let playerName = $state('');
	let joined = $state(false);
	let connecting = $state(false);
	let error = $state('');
	let linkCopied = $state(false);

	let room: Room | null = $state(null);
	let participants = $state<Participant[]>([]);
	let micEnabled = $state(true);
	let camEnabled = $state(true);
	let screenSharing = $state(false);
	let screenShareTrack = $state<RemoteTrack | null>(null);
	let screenShareParticipant = $state<string>('');

	let chatOpen = $state(false);
	let chatMessages = $state<{ sender: string; text: string; time: string }[]>([]);
	let chatInput = $state('');

	let videoGrid: HTMLDivElement;
	let screenShareEl: HTMLVideoElement;
	let chatContainer: HTMLDivElement;

	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	onMount(() => {
		if (urlRole === 'master') {
			isMaster = true;
			playerName = urlName || 'Master';
			joinRoom();
		}
	});

	onDestroy(() => {
		if (room) room.disconnect();
	});

	async function joinRoom() {
		connecting = true;
		error = '';
		try {
			const res = await fetch('/api/join-room', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ roomId, participantName: playerName, role: isMaster ? 'master' : 'player' }),
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Error al unirse');
			}
			const { token } = await res.json();
			await connectToRoom(token);
			joined = true;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Error desconocido';
		} finally {
			connecting = false;
		}
	}

	async function connectToRoom(token: string) {
		room = new Room({
			adaptiveStream: true,
			dynacast: true,
			videoCaptureDefaults: { resolution: { width: 1280, height: 720, frameRate: 24 } },
		});

		room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
		room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
		room.on(RoomEvent.ParticipantConnected, refreshParticipants);
		room.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
		room.on(RoomEvent.TrackMuted, refreshParticipants);
		room.on(RoomEvent.TrackUnmuted, refreshParticipants);
		room.on(RoomEvent.DataReceived, handleDataReceived);
		room.on(RoomEvent.Disconnected, handleDisconnect);

		try {
			await room.connect(PUBLIC_LIVEKIT_URL, token);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message.toLowerCase() : '';
			if (msg.includes('full') || msg.includes('max')) {
				throw new Error('La sala está llena (máximo 6 participantes)');
			} else if (msg.includes('not found') || msg.includes('does not exist')) {
				throw new Error('La sala no existe o ha expirado');
			} else {
				throw new Error('Error al conectar: ' + (e instanceof Error ? e.message : String(e)));
			}
		}

		try {
			await room.localParticipant.enableCameraAndMicrophone();
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message.toLowerCase() : '';
			if (msg.includes('permission') || msg.includes('denied') || msg.includes('notallowed') || msg.includes('not allowed')) {
				error = 'No se pudo acceder a la cámara/micrófono. Verifica los permisos del navegador.';
			}
			// Continue without media — user is still connected
		}

		refreshParticipants();
	}

	function refreshParticipants() {
		if (!room) return;
		const remote = Array.from(room.remoteParticipants.values());
		participants = [room.localParticipant, ...remote];
		requestAnimationFrame(() => attachAllTracks());
	}

	function attachAllTracks() {
		if (!room || !videoGrid) return;
		participants.forEach((p, i) => {
			const container = videoGrid.querySelector(`[data-participant="${i}"]`) as HTMLDivElement;
			if (!container) return;
			const videoEl = container.querySelector('video');
			if (!videoEl) return;
			videoEl.srcObject = null;

			const camPub = p.getTrackPublication(Track.Source.Camera);
			if (camPub?.track) camPub.track.attach(videoEl);

			if (p !== room!.localParticipant) {
				const audioPub = p.getTrackPublication(Track.Source.Microphone);
				if (audioPub?.track) {
					let audioEl = container.querySelector('audio') as HTMLAudioElement;
					if (!audioEl) {
						audioEl = document.createElement('audio');
						audioEl.autoplay = true;
						container.appendChild(audioEl);
					}
					(audioPub.track as RemoteTrack).attach(audioEl);
				}
			}
		});
	}

	function handleTrackSubscribed(track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) {
		if (track.source === Track.Source.ScreenShare) {
			screenShareTrack = track;
			screenShareParticipant = participant.name || participant.identity;
			requestAnimationFrame(() => { if (screenShareEl) track.attach(screenShareEl); });
		} else if (track.source === Track.Source.ScreenShareAudio) {
			const audioEl = document.createElement('audio');
			audioEl.id = 'screen-share-audio';
			audioEl.autoplay = true;
			track.attach(audioEl);
			document.body.appendChild(audioEl);
		}
		refreshParticipants();
	}

	function handleTrackUnsubscribed(track: RemoteTrack) {
		if (track.source === Track.Source.ScreenShare) {
			screenShareTrack = null;
			screenShareParticipant = '';
		}
		track.detach();
		document.getElementById('screen-share-audio')?.remove();
		refreshParticipants();
	}

	function handleDataReceived(payload: Uint8Array, participant?: RemoteParticipant, _kind?: any, topic?: string) {
		if (topic === 'chat') {
			try {
				const msg = JSON.parse(decoder.decode(payload));
				chatMessages = [...chatMessages, { sender: msg.sender, text: msg.text, time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }];
				requestAnimationFrame(() => { if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight; });
			} catch {}
		}
		if (topic === 'kick') {
			const kicked = decoder.decode(payload);
			if (room && kicked === room.localParticipant.identity) {
				room.disconnect();
				error = 'Has sido expulsado de la sala por el Master.';
				joined = false;
			}
		}
		if (topic === 'room-closed') {
			if (room) { room.disconnect(); error = 'El Master ha cerrado la sala.'; joined = false; }
		}
	}

	function handleDisconnect(reason?: DisconnectReason) {
		if (reason === DisconnectReason.PARTICIPANT_REMOVED) error = 'Has sido expulsado de la sala.';
		joined = false;
		participants = [];
		screenShareTrack = null;
	}

	async function toggleMic() { if (!room) return; micEnabled = !micEnabled; await room.localParticipant.setMicrophoneEnabled(micEnabled); }
	async function toggleCam() { if (!room) return; camEnabled = !camEnabled; await room.localParticipant.setCameraEnabled(camEnabled); refreshParticipants(); }
	async function toggleScreenShare() { if (!room || !isMaster) return; screenSharing = !screenSharing; await room.localParticipant.setScreenShareEnabled(screenSharing, { audio: true }); }
	async function leaveRoom() { if (room) room.disconnect(); joined = false; participants = []; window.location.href = '/'; }

	async function kickParticipant(identity: string) {
		if (!room || !isMaster) return;
		await room.localParticipant.publishData(encoder.encode(identity), { reliable: true, topic: 'kick' });
	}

	async function closeRoom() {
		if (!room || !isMaster) return;
		await room.localParticipant.publishData(encoder.encode('close'), { reliable: true, topic: 'room-closed' });
		setTimeout(() => { room?.disconnect(); window.location.href = '/'; }, 500);
	}

	async function sendChat() {
		if (!room || !chatInput.trim()) return;
		const msg = { sender: playerName, text: chatInput.trim() };
		await room.localParticipant.publishData(encoder.encode(JSON.stringify(msg)), { reliable: true, topic: 'chat' });
		chatMessages = [...chatMessages, { ...msg, time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }];
		chatInput = '';
		requestAnimationFrame(() => { if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight; });
	}

	function copyLink() {
		navigator.clipboard.writeText(`${window.location.origin}/sala/${roomId}`);
		linkCopied = true;
		setTimeout(() => (linkCopied = false), 2000);
	}

	function isParticipantMuted(p: Participant): boolean {
		const mic = p.getTrackPublication(Track.Source.Microphone);
		return !mic || mic.isMuted;
	}

	function gridCols(count: number): string {
		if (count <= 1) return 'grid-cols-1';
		if (count <= 2) return 'grid-cols-1 md:grid-cols-2';
		if (count <= 4) return 'grid-cols-2';
		return 'grid-cols-2 md:grid-cols-3';
	}
</script>

{#if !joined && !isMaster}
	<main class="flex min-h-screen flex-col items-center justify-center px-4">
		<div class="w-full max-w-md text-center">
			<div class="mb-8">
				<span class="text-5xl">🎲</span>
				<h1 class="mt-2 text-3xl font-bold text-white">Unirse a la partida</h1>
				<p class="mt-2 text-gray-400">Introduce tu nombre para entrar</p>
			</div>
			<div class="rounded-2xl border border-gray-800 bg-gray-900 p-8">
				{#if error}
					<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{error}</div>
				{/if}
				<form onsubmit={(e) => { e.preventDefault(); joinRoom(); }}>
					<input type="text" bind:value={playerName} placeholder="Tu nombre de jugador" required maxlength={20}
						class="mb-4 w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-center text-lg text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
					<button type="submit" disabled={connecting || !playerName.trim()}
						class="w-full rounded-xl bg-indigo-600 px-6 py-3 text-lg font-semibold text-white transition-all hover:bg-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60">
						{#if connecting}Conectando…{:else}⚔️ Entrar a la partida{/if}
					</button>
				</form>
			</div>
		</div>
	</main>

{:else if joined}
	<div class="flex h-screen flex-col bg-gray-950">
		<header class="flex items-center justify-between border-b border-gray-800 px-4 py-2">
			<div class="flex items-center gap-2">
				<span class="text-xl">🎲</span>
				<span class="text-sm font-medium text-gray-300">RolCall</span>
				{#if isMaster}<span class="rounded bg-amber-600 px-2 py-0.5 text-xs font-bold text-white">MASTER</span>{/if}
			</div>
			<div class="flex items-center gap-2">
				{#if isMaster}
					<button onclick={copyLink} class="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-gray-800">
						{linkCopied ? '✅ Copiado!' : '🔗 Copiar enlace'}
					</button>
				{/if}
				<span class="text-sm text-gray-500">{participants.length}/6</span>
			</div>
		</header>

		<div class="flex flex-1 overflow-hidden">
			<div class="flex flex-1 flex-col">
				{#if screenShareTrack}
					<div class="relative flex-1 bg-black">
						<video bind:this={screenShareEl} autoplay playsinline class="h-full w-full object-contain"></video>
						<div class="absolute left-3 top-3 rounded-lg bg-black/70 px-3 py-1 text-sm text-white">
							🖥️ {screenShareParticipant} comparte pantalla
						</div>
					</div>
				{/if}

				<div bind:this={videoGrid}
					class="grid flex-1 gap-2 p-2 {screenShareTrack ? 'max-h-40 grid-cols-6' : gridCols(participants.length)}">
					{#each participants as p, i (p.identity)}
						<div data-participant={i} class="group relative overflow-hidden rounded-xl bg-gray-900 {screenShareTrack ? '' : 'aspect-video'}">
							<video autoplay playsinline muted={p === room?.localParticipant} class="h-full w-full object-cover"></video>
							<div class="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
								<span class="flex items-center gap-1 text-sm font-medium text-white">
									{#if p === room?.localParticipant && isMaster}<span class="text-amber-400">👑</span>{/if}
									{p.name || p.identity}
									{#if p === room?.localParticipant}<span class="text-gray-400">(tú)</span>{/if}
								</span>
								{#if isParticipantMuted(p)}<span class="text-red-400 text-xs">🔇</span>{/if}
							</div>
							{#if isMaster && p !== room?.localParticipant}
								<button onclick={() => kickParticipant(p.identity)}
									class="absolute right-2 top-2 rounded-full bg-red-600/80 p-1.5 text-xs text-white opacity-0 transition group-hover:opacity-100"
									title="Expulsar">✕</button>
							{/if}
						</div>
					{/each}
				</div>
			</div>

			{#if chatOpen}
				<div class="flex w-80 flex-col border-l border-gray-800 bg-gray-900">
					<div class="flex items-center justify-between border-b border-gray-800 px-4 py-3">
						<span class="font-medium text-white">💬 Chat</span>
						<button onclick={() => (chatOpen = false)} class="text-gray-400 hover:text-white">✕</button>
					</div>
					<div bind:this={chatContainer} class="flex-1 overflow-y-auto p-4 space-y-3">
						{#each chatMessages as msg}
							<div>
								<div class="flex items-baseline gap-2">
									<span class="text-sm font-semibold text-indigo-400">{msg.sender}</span>
									<span class="text-xs text-gray-600">{msg.time}</span>
								</div>
								<p class="text-sm text-gray-300">{msg.text}</p>
							</div>
						{/each}
						{#if chatMessages.length === 0}<p class="text-center text-sm text-gray-600">Aún no hay mensajes</p>{/if}
					</div>
					<form onsubmit={(e) => { e.preventDefault(); sendChat(); }} class="flex border-t border-gray-800 p-3 gap-2">
						<input type="text" bind:value={chatInput} placeholder="Escribe un mensaje…" maxlength={500}
							class="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none" />
						<button type="submit" disabled={!chatInput.trim()} class="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50">↑</button>
					</form>
				</div>
			{/if}
		</div>

		<div class="flex items-center justify-center gap-3 border-t border-gray-800 bg-gray-900 px-4 py-3">
			<button onclick={toggleMic} class="rounded-full p-3 text-xl transition {micEnabled ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-red-600 hover:bg-red-500 text-white'}"
				title={micEnabled ? 'Silenciar' : 'Activar micro'}>{micEnabled ? '🎙️' : '🔇'}</button>
			<button onclick={toggleCam} class="rounded-full p-3 text-xl transition {camEnabled ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-red-600 hover:bg-red-500 text-white'}"
				title={camEnabled ? 'Desactivar cámara' : 'Activar cámara'}>{camEnabled ? '📹' : '📷'}</button>
			{#if isMaster}
				<button onclick={toggleScreenShare} class="rounded-full p-3 text-xl transition {screenSharing ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'}"
					title={screenSharing ? 'Dejar de compartir' : 'Compartir pantalla'}>🖥️</button>
			{/if}
			<button onclick={() => (chatOpen = !chatOpen)} class="rounded-full p-3 text-xl transition {chatOpen ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-gray-700 hover:bg-gray-600'} text-white" title="Chat">💬</button>
			<div class="mx-2 h-8 w-px bg-gray-700"></div>
			{#if isMaster}
				<button onclick={closeRoom} class="rounded-full bg-red-700 p-3 text-xl text-white transition hover:bg-red-600" title="Cerrar sala">🚪</button>
			{:else}
				<button onclick={leaveRoom} class="rounded-full bg-red-700 p-3 text-xl text-white transition hover:bg-red-600" title="Salir">📞</button>
			{/if}
		</div>
	</div>

{:else}
	<main class="flex min-h-screen items-center justify-center">
		<div class="text-center">
			<div class="mb-4 text-4xl">🎲</div>
			<p class="text-lg text-gray-400">Conectando a la sala…</p>
			{#if error}
				<div class="mt-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{error}</div>
				<a href="/" class="mt-4 inline-block text-indigo-400 hover:underline">Volver al inicio</a>
			{/if}
		</div>
	</main>
{/if}
