<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { PUBLIC_LIVEKIT_URL } from '$env/static/public';
	import {
		Room,
		RoomEvent,
		Track,
		DisconnectReason,
		ConnectionQuality,
		type RemoteParticipant,
		type RemoteTrack,
		type RemoteTrackPublication,
		type Participant,
		type LocalVideoTrack,
	} from 'livekit-client';
	import { BackgroundBlur, VirtualBackground, type ProcessorWrapper } from '@livekit/track-processors';

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

	// Background filter state
	let backgroundMode = $state<'none' | 'blur' | 'image'>('none');
	let backgroundMenuOpen = $state(false);
	let currentProcessor: ProcessorWrapper<any> | null = null;

	// Noise suppression state
	let noiseSuppression = $state(false);

	let chatOpen = $state(false);
	let chatMessages = $state<{ sender: string; text: string; time: string }[]>([]);
	let chatInput = $state('');

	// Recording state
	let isRecording = $state(false);
	let recordingNotification = $state(false);
	let downloadNotification = $state(false);
	let mediaRecorder: MediaRecorder | null = null;
	let recordedChunks: Blob[] = [];

	// Per-participant volume state
	let participantVolumes = $state(new Map<string, number>());
	let preMuteVolumes = $state(new Map<string, number>());
	let screenShareVolume = $state(1.0);


	let videoGrid: HTMLDivElement;
	let screenShareEl: HTMLVideoElement;
	let chatContainer: HTMLDivElement;
	let backgroundImageInput: HTMLInputElement;

	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	// Reconnection state
	let reconnecting = $state(false);
	let reconnectAttempts = 0;
	let lastToken = '';

	// Load preferences from localStorage
	function loadPreferences() {
		if (typeof window === 'undefined') return;
		
		try {
			const saved = localStorage.getItem('rolcall-preferences');
			if (saved) {
				const prefs = JSON.parse(saved);
				if (prefs.lastUsedName && !urlName) {
					playerName = prefs.lastUsedName;
				}
				if (prefs.backgroundMode) {
					backgroundMode = prefs.backgroundMode;
				}
			}
		} catch (e) {
			console.error('Error loading preferences:', e);
		}
	}

	// Save preferences to localStorage
	function savePreferences() {
		if (typeof window === 'undefined') return;
		
		try {
			localStorage.setItem('rolcall-preferences', JSON.stringify({
				lastUsedName: playerName,
				backgroundMode: backgroundMode,
			}));
		} catch (e) {
			console.error('Error saving preferences:', e);
		}
	}

	// Auto-reconnect function
	async function attemptReconnect() {
		if (reconnecting || !lastToken) return;
		
		reconnecting = true;
		reconnectAttempts++;
		
		try {
			await new Promise(resolve => setTimeout(resolve, 2000 * reconnectAttempts));
			await connectToRoom(lastToken);
			joined = true;
			reconnecting = false;
			reconnectAttempts = 0;
			error = '';
		} catch (e) {
			if (reconnectAttempts < 3) {
				attemptReconnect();
			} else {
				reconnecting = false;
				error = 'No se pudo reconectar. Intenta recargar la página.';
			}
		}
	}

	function parseParticipantName(identity: string): string {
		return identity.replace(/-\d+$/, '');
	}

	function getVolumeIcon(volume: number): string {
		if (volume === 0) return '🔇';
		if (volume <= 0.5) return '🔉';
		return '🔊';
	}

	function loadSavedVolumes(): Map<string, number> {
		if (typeof window === 'undefined') return new Map();
		try {
			const raw = localStorage.getItem('rolcall-volumes');
			if (!raw) return new Map();
			const obj = JSON.parse(raw) as Record<string, number>;
			return new Map(Object.entries(obj));
		} catch (e) {
			console.error('[RolCall] Error loading saved volumes:', e);
			return new Map();
		}
	}

	function saveVolumesToStorage(map: Map<string, number>): void {
		if (typeof window === 'undefined') return;
		try {
			localStorage.setItem('rolcall-volumes', JSON.stringify(Object.fromEntries(map)));
		} catch (e) {
			console.error('[RolCall] Error saving volumes:', e);
		}
	}

	function setParticipantVolume(identity: string, volume: number): void {
		if (!room) return;
		const participant = room.remoteParticipants.get(identity);
		if (!participant) return;
		try {
			participant.setVolume(volume);
		} catch (e) {
			console.error('[RolCall] Error calling setVolume:', e);
		}

		const next = new Map(participantVolumes);
		next.set(identity, volume);
		participantVolumes = next;

		const nameKey = parseParticipantName(identity);
		const storageMap = loadSavedVolumes();
		storageMap.set(nameKey, volume);
		saveVolumesToStorage(storageMap);
	}

	function toggleParticipantMute(identity: string): void {
		const currentVol = participantVolumes.get(identity) ?? 1.0;
		if (currentVol === 0) {
			const savedPre = preMuteVolumes.get(identity) ?? 1.0;
			setParticipantVolume(identity, savedPre);
			const next = new Map(preMuteVolumes);
			next.delete(identity);
			preMuteVolumes = next;
		} else {
			const next = new Map(preMuteVolumes);
			next.set(identity, currentVol);
			preMuteVolumes = next;
			setParticipantVolume(identity, 0);
		}
	}

	function applyStoredVolumes(): void {
		if (!room || room.remoteParticipants.size === 0) return;
		const saved = loadSavedVolumes();
		if (saved.size === 0) return;

		room.remoteParticipants.forEach((participant) => {
			const nameKey = parseParticipantName(participant.identity);
			const savedVol = saved.get(nameKey);
			if (savedVol === undefined) return;
			try {
				participant.setVolume(savedVol);
			} catch (e) {
				console.error('[RolCall] Error applying stored volume:', e);
			}
			const next = new Map(participantVolumes);
			next.set(participant.identity, savedVol);
			participantVolumes = next;
		});
	}

	function applyStoredVolumeForParticipant(participant: RemoteParticipant): void {
		const saved = loadSavedVolumes();
		const nameKey = parseParticipantName(participant.identity);
		const savedVol = saved.get(nameKey);
		if (savedVol === undefined) return;
		try {
			participant.setVolume(savedVol);
		} catch (e) {
			console.error('[RolCall] Error applying stored volume for participant:', e);
		}
		const next = new Map(participantVolumes);
		next.set(participant.identity, savedVol);
		participantVolumes = next;
	}

	function setScreenShareVolume(volume: number): void {
		screenShareVolume = volume;
		const audioEl = document.getElementById('screen-share-audio') as HTMLAudioElement | null;
		if (audioEl) audioEl.volume = volume;
		const storageMap = loadSavedVolumes();
		storageMap.set(`__screenshare__${screenShareParticipant}`, volume);
		saveVolumesToStorage(storageMap);
	}

	onMount(() => {
		loadPreferences();
		if (urlRole === 'master') {
			isMaster = true;
			playerName = urlName || 'Anfitrión';
			joinRoom();
		}
	});

	onDestroy(() => {
		if (room) room.disconnect();
		if (currentProcessor) currentProcessor.destroy();
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
		lastToken = token;
		await connectToRoom(token);
		joined = true;
		savePreferences();
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
		room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
		room.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
		room.on(RoomEvent.TrackMuted, refreshParticipants);
		room.on(RoomEvent.TrackUnmuted, refreshParticipants);
		room.on(RoomEvent.DataReceived, handleDataReceived);
		room.on(RoomEvent.Disconnected, handleDisconnect);
		room.on(RoomEvent.ConnectionQualityChanged, refreshParticipants);

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
		applyStoredVolumes();
	}

	function refreshParticipants() {
		if (!room) return;
		const remote = Array.from(room.remoteParticipants.values());
		participants = [room.localParticipant, ...remote];
		requestAnimationFrame(() => attachAllTracks());
	}

	function handleParticipantConnected(participant: RemoteParticipant) {
		refreshParticipants();
		applyStoredVolumeForParticipant(participant);
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
			const saved = loadSavedVolumes();
			const savedVol = saved.get(`__screenshare__${screenShareParticipant}`);
			if (savedVol !== undefined) screenShareVolume = savedVol;
		} else if (track.source === Track.Source.ScreenShareAudio) {
			const audioEl = document.createElement('audio');
			audioEl.id = 'screen-share-audio';
			audioEl.autoplay = true;
			audioEl.volume = screenShareVolume;
			track.attach(audioEl);
			document.body.appendChild(audioEl);
		}
		refreshParticipants();
	}

	function handleTrackUnsubscribed(track: RemoteTrack) {
		if (track.source === Track.Source.ScreenShare) {
			screenShareTrack = null;
			screenShareParticipant = '';
			screenShareVolume = 1.0;
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
				error = 'Has sido expulsado de la sala por el anfitrión.';
				joined = false;
			}
		}
		if (topic === 'room-closed') {
			if (room) { room.disconnect(); error = 'El anfitrión ha cerrado la sala.'; joined = false; }
		}
	}

	function handleDisconnect(reason?: DisconnectReason) {
		if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
			error = 'Has sido expulsado de la sala.';
		} else if (reason === DisconnectReason.CLIENT_INITIATED) {
			// User intentionally left - don't reconnect
		} else {
			// Connection lost - attempt reconnect
			attemptReconnect();
			return;
		}
		joined = false;
		participants = [];
		screenShareTrack = null;
	}

	async function toggleMic() { 
		if (!room) return; 
		micEnabled = !micEnabled; 
		await room.localParticipant.setMicrophoneEnabled(micEnabled, {
			noiseSuppression,
			echoCancellation: true,
			autoGainControl: true
		}); 
	}
	
	async function toggleNoiseSuppression() {
		if (!room) return;
		noiseSuppression = !noiseSuppression;
		// Disable and re-enable mic to apply new constraints
		const wasEnabled = micEnabled;
		if (wasEnabled) {
			await room.localParticipant.setMicrophoneEnabled(false);
			await room.localParticipant.setMicrophoneEnabled(true, {
				noiseSuppression,
				echoCancellation: true,
				autoGainControl: true
			});
		}
	}
	async function toggleCam() { if (!room) return; camEnabled = !camEnabled; await room.localParticipant.setCameraEnabled(camEnabled); refreshParticipants(); }
	async function toggleScreenShare() { if (!room || !isMaster) return; screenSharing = !screenSharing; await room.localParticipant.setScreenShareEnabled(screenSharing, { audio: true }); }
	async function leaveRoom() { if (room) room.disconnect(); joined = false; participants = []; window.location.href = '/'; }

	async function kickParticipant(identity: string) {
		if (!room || !isMaster) return;
		await room.localParticipant.publishData(encoder.encode(identity), { reliable: true, topic: 'kick' });
	}

	async function closeRoom() {
		if (isRecording) stopRecording();
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

	function getConnectionQualityIcon(p: Participant): { icon: string; color: string; title: string } {
		const quality = p.connectionQuality;
		if (quality === ConnectionQuality.Excellent) {
			return { icon: '🟢', color: 'text-green-400', title: 'Excelente' };
		} else if (quality === ConnectionQuality.Good) {
			return { icon: '🟡', color: 'text-yellow-400', title: 'Buena' };
		} else if (quality === ConnectionQuality.Poor) {
			return { icon: '🟠', color: 'text-orange-400', title: 'Pobre' };
		}
		return { icon: '🔴', color: 'text-red-500', title: 'Mala conexión' };
	}

	// Background filter functions
	async function setBackgroundNone() {
		if (!room) return;
		if (currentProcessor) {
			await currentProcessor.destroy();
			currentProcessor = null;
		}
		backgroundMode = 'none';
		savePreferences();
		backgroundMenuOpen = false;
	}

	async function setBackgroundBlur() {
		if (!room) return;
		const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
		if (!videoTrack) return;

		try {
			if (currentProcessor) await currentProcessor.destroy();
			const blur = BackgroundBlur(10);
			await videoTrack.setProcessor(blur);
			currentProcessor = blur;
			backgroundMode = 'blur';
		savePreferences();
			backgroundMenuOpen = false;
		} catch (e) {
			console.error('Error aplicando blur:', e);
		}
	}

	async function setBackgroundImage(imageUrl: string) {
		if (!room) return;
		const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
		if (!videoTrack) return;

		try {
			if (currentProcessor) await currentProcessor.destroy();
			const virtualBg = VirtualBackground(imageUrl);
			await videoTrack.setProcessor(virtualBg);
			currentProcessor = virtualBg;
			backgroundMode = 'image';
		savePreferences();
			backgroundMenuOpen = false;
		} catch (e) {
			console.error('Error aplicando fondo:', e);
		}
	}

	function handleBackgroundImageUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		
		const file = input.files[0];
		const reader = new FileReader();
		reader.onload = async (ev) => {
			const imageUrl = ev.target?.result as string;
			if (imageUrl) {
				await setBackgroundImage(imageUrl);
			}
		};
		reader.readAsDataURL(file);
	}

	async function toggleRecording() {
		if (!room || !isMaster) return;
		
		if (isRecording) {
			stopRecording();
		} else {
			await startRecording();
		}
	}

	async function startRecording() {
		if (!room) return;
		
		try {
			// Crear un AudioContext para mezclar todos los streams de audio
			const audioContext = new AudioContext();
			const destination = audioContext.createMediaStreamDestination();
			
			// Agregar el audio local (micrófono del master)
			const localAudioTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
			if (localAudioTrack) {
				const localStream = new MediaStream([localAudioTrack.mediaStreamTrack]);
				const localSource = audioContext.createMediaStreamSource(localStream);
				localSource.connect(destination);
			}
			
			// Agregar el audio de todos los participantes remotos
			room.remoteParticipants.forEach((participant) => {
				const audioTrack = participant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
				if (audioTrack) {
					const stream = new MediaStream([audioTrack.mediaStreamTrack]);
					const source = audioContext.createMediaStreamSource(stream);
					source.connect(destination);
				}
			});
			
			// Verificar soporte de codecs para audio
			const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
				? 'audio/webm;codecs=opus'
				: 'audio/webm';

			recordedChunks = [];
			mediaRecorder = new MediaRecorder(destination.stream, { mimeType });

			mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					recordedChunks.push(event.data);
				}
			};

			mediaRecorder.onstop = () => {
				audioContext.close();
				downloadRecording();
			};

			mediaRecorder.start(1000);
			isRecording = true;
			
			// Mostrar notificación temporal
			recordingNotification = true;
			setTimeout(() => {
				recordingNotification = false;
			}, 3000);

			// Enviar mensaje a todos los participantes
			await room.localParticipant.publishData(
				encoder.encode(JSON.stringify({ action: 'recording-started' })),
				{ reliable: true, topic: 'recording' }
			);
		} catch (e: any) {
			console.error('Error iniciando grabación:', e);
			if (e.name === 'NotAllowedError') {
				error = 'Permiso de grabación denegado.';
			} else if (e.name === 'NotSupportedError') {
				error = 'Tu navegador no soporta grabación de audio. Usa Chrome, Edge o Firefox.';
			} else {
				error = 'Error al iniciar la grabación: ' + e.message;
			}
			setTimeout(() => error = '', 5000);
		}
	}

	function stopRecording() {
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.stop();
			mediaRecorder.stream.getTracks().forEach(track => track.stop());
			isRecording = false;
		}
	}

	function downloadRecording() {
		if (recordedChunks.length === 0) return;

		const blob = new Blob(recordedChunks, { type: 'audio/webm' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.style.display = 'none';
		a.href = url;
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		a.download = `rolcall-audio-${roomId}-${timestamp}.webm`;
		document.body.appendChild(a);
		a.click();
		
		// Mostrar notificación de descarga
		downloadNotification = true;
		setTimeout(() => {
			downloadNotification = false;
		}, 5000);
		
		console.log('✅ Grabación descargada: audio WebM/Opus. Reproducir con VLC, Chrome, Firefox o Audacity');
		
		// Limpiar
		setTimeout(() => {
			URL.revokeObjectURL(url);
			document.body.removeChild(a);
		}, 100);
		
		recordedChunks = [];
	}

</script>

{#if !joined && !isMaster}
	<main class="flex min-h-screen flex-col items-center justify-center px-4">
		<div class="w-full max-w-md text-center">
			<div class="mb-8">
				<span class="text-5xl">📹</span>
				<h1 class="mt-2 text-3xl font-bold text-white">Unirse a la videollamada</h1>
				<p class="mt-2 text-gray-400">Introduce tu nombre para entrar</p>
			</div>
			<div class="rounded-2xl border border-gray-800 bg-gray-900 p-8">
				{#if error}
					<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{error}</div>
				{/if}
				<form onsubmit={(e) => { e.preventDefault(); joinRoom(); }}>
					<input type="text" bind:value={playerName} placeholder="Tu nombre" required maxlength={20}
						class="mb-4 w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-center text-lg text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
					<button type="submit" disabled={connecting || !playerName.trim()}
						class="w-full rounded-xl bg-indigo-600 px-6 py-3 text-lg font-semibold text-white transition-all hover:bg-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60">
						{#if connecting}Conectando…{:else}Unirse{/if}
					</button>
				</form>
			</div>
		</div>
	</main>

{:else if joined}
	<div class="flex h-screen flex-col bg-gray-950">

		<!-- Recording notification -->
		{#if recordingNotification}
			<div class="fixed left-1/2 top-16 z-50 -translate-x-1/2 transform rounded-lg border border-red-600 bg-red-950 px-6 py-3 shadow-xl">
				<div class="flex items-center gap-2">
					<span class="h-3 w-3 animate-pulse rounded-full bg-red-500"></span>
					<span class="font-semibold text-red-200">La sesión se está grabando</span>
				</div>
			</div>
		{/if}

		{#if downloadNotification}
			<div class="fixed left-1/2 top-16 z-50 -translate-x-1/2 transform rounded-lg border border-green-600 bg-green-950 px-6 py-3 shadow-xl">
				<div class="flex flex-col gap-1">
					<div class="flex items-center gap-2">
						<span class="text-xl">💾</span>
						<span class="font-semibold text-green-200">Grabación descargada</span>
					</div>
					<span class="text-xs text-green-300">Archivo: audio WebM/Opus • Reproducir con VLC, Chrome o Audacity</span>
				</div>
			</div>
		{/if}

		<header class="flex items-center justify-between border-b border-gray-800 px-4 py-2">
			<div class="flex items-center gap-2">
				<svg class="h-5 w-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
				<span class="text-sm font-medium text-gray-300">RolCall</span>
				{#if isMaster}<span class="rounded bg-amber-600 px-2 py-0.5 text-xs font-bold text-white">ANFITRIÓN</span>{/if}
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
						<div class="absolute right-3 top-3 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-1.5">
							<button
								onclick={() => setScreenShareVolume(screenShareVolume === 0 ? 1.0 : 0)}
								class="text-sm text-white transition hover:text-gray-300"
								title="Silenciar audio de pantalla"
							>{getVolumeIcon(screenShareVolume)}</button>
							<input
								type="range"
								min="0"
								max="100"
								value={screenShareVolume * 100}
								oninput={(e) => setScreenShareVolume(e.currentTarget.valueAsNumber / 100)}
								class="w-20 accent-indigo-500"
								title="Volumen audio de pantalla compartida"
							/>
						</div>
					</div>
				{/if}

				<div bind:this={videoGrid}
					class="grid flex-1 gap-2 p-2 {screenShareTrack ? 'max-h-40 grid-cols-6' : gridCols(participants.length)}">
					{#each participants as p, i (p.identity)}
						{@const quality = getConnectionQualityIcon(p)}
						{@const isRemote = p !== room?.localParticipant}
						{@const currentVol = participantVolumes.get(p.identity) ?? 1.0}
						<div data-participant={i} class="group relative overflow-hidden rounded-xl bg-gray-900 {screenShareTrack ? '' : 'aspect-video'}">
							<video autoplay playsinline muted={p === room?.localParticipant} class="h-full w-full object-cover"></video>
							
							<!-- Indicador de conexión en esquina superior derecha -->
							<div class="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 backdrop-blur-sm">
								<span class="{quality.color} text-sm" title={quality.title}>{quality.icon}</span>
							</div>
							
							<div class="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
								<span class="flex items-center gap-1 text-sm font-medium text-white">
									{#if p === room?.localParticipant && isMaster}<span class="text-amber-400">👑</span>{/if}
									{p.name || p.identity}
									{#if p === room?.localParticipant}<span class="text-gray-400">(tú)</span>{/if}
								</span>
								<div class="flex items-center gap-1">
									{#if isParticipantMuted(p)}<span class="text-red-400 text-xs">🔇</span>{/if}
								</div>
							</div>
							{#if isRemote}
								<button
									onclick={() => toggleParticipantMute(p.identity)}
									class="absolute bottom-9 left-2 rounded-full bg-black/70 px-1.5 py-0.5 text-sm text-white opacity-100 transition"
									title="Silenciar / Restaurar volumen"
								>{getVolumeIcon(currentVol)}</button>
								<div class="absolute bottom-9 left-9 right-2 flex items-center opacity-100 transition">
									<input
										type="range"
										min="0"
										max="100"
										value={currentVol * 100}
										oninput={(e) => setParticipantVolume(p.identity, e.currentTarget.valueAsNumber / 100)}
										class="w-full accent-indigo-500"
										title="Volumen de {p.name || p.identity}"
									/>
								</div>
							{/if}
							{#if isMaster && isRemote}
								<button onclick={() => kickParticipant(p.identity)}
									class="absolute right-2 top-8 rounded-full bg-red-600/80 p-1.5 text-xs text-white opacity-0 transition group-hover:opacity-100"
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
			<button onclick={toggleNoiseSuppression} class="rounded-full p-3 text-xl transition {noiseSuppression ? 'bg-green-600 hover:bg-green-500' : 'bg-gray-700 hover:bg-gray-600'} text-white"
				title={noiseSuppression ? 'Reducción de ruido activa' : 'Activar reducción de ruido'}>{noiseSuppression ? '✨' : '🔊'}</button>
			<button onclick={toggleCam} class="rounded-full p-3 text-xl transition {camEnabled ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-red-600 hover:bg-red-500 text-white'}"
				title={camEnabled ? 'Desactivar cámara' : 'Activar cámara'}>{camEnabled ? '📹' : '📷'}</button>
			
			<!-- Background filter button with dropdown -->
			<div class="relative">
				<button onclick={() => backgroundMenuOpen = !backgroundMenuOpen} 
					class="rounded-full p-3 text-xl transition {backgroundMode !== 'none' ? 'bg-green-600 hover:bg-green-500' : 'bg-gray-700 hover:bg-gray-600'} text-white"
					title="Fondo virtual">
					🎨
				</button>
				
				{#if backgroundMenuOpen}
					<div class="absolute bottom-full mb-2 right-0 w-56 rounded-lg border border-gray-700 bg-gray-800 p-2 shadow-xl">
						<div class="text-xs font-semibold text-gray-400 px-2 py-1">Fondo virtual</div>
						<button onclick={setBackgroundNone} 
							class="w-full rounded px-3 py-2 text-left text-sm text-white hover:bg-gray-700 transition {backgroundMode === 'none' ? 'bg-gray-700' : ''}">
							🚫 Sin filtro
						</button>
						<button onclick={setBackgroundBlur} 
							class="w-full rounded px-3 py-2 text-left text-sm text-white hover:bg-gray-700 transition {backgroundMode === 'blur' ? 'bg-gray-700' : ''}">
							💨 Difuminar fondo
						</button>
						<button onclick={() => backgroundImageInput.click()} 
							class="w-full rounded px-3 py-2 text-left text-sm text-white hover:bg-gray-700 transition {backgroundMode === 'image' ? 'bg-gray-700' : ''}">
							🖼️ Imagen personalizada
						</button>
						<input bind:this={backgroundImageInput} type="file" accept="image/*" onchange={handleBackgroundImageUpload} class="hidden" />
					</div>
				{/if}
			</div>

			{#if isMaster}
				<button onclick={toggleScreenShare} class="rounded-full p-3 text-xl transition {screenSharing ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'}"
					title={screenSharing ? 'Dejar de compartir' : 'Compartir pantalla'}>🖥️</button>
				<button onclick={toggleRecording} class="rounded-full p-3 text-xl transition {isRecording ? 'bg-red-600 hover:bg-red-500 animate-pulse text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'}"
					title={isRecording ? 'Detener grabación' : 'Iniciar grabación'}>⏺️</button>
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
