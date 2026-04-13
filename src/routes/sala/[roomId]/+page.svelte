<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { PUBLIC_LIVEKIT_URL } from '$env/static/public';
	import Mic from '@lucide/svelte/icons/mic';
	import MicOff from '@lucide/svelte/icons/mic-off';
	import Video from '@lucide/svelte/icons/video';
	import VideoOff from '@lucide/svelte/icons/video-off';
	import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import Volume1 from '@lucide/svelte/icons/volume-1';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import Activity from '@lucide/svelte/icons/activity';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Circle from '@lucide/svelte/icons/circle';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import LogOut from '@lucide/svelte/icons/log-out';
	import PhoneOff from '@lucide/svelte/icons/phone-off';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Check from '@lucide/svelte/icons/check';
	import Crown from '@lucide/svelte/icons/crown';
	import Wifi from '@lucide/svelte/icons/wifi';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Ban from '@lucide/svelte/icons/ban';
	import Blend from '@lucide/svelte/icons/blend';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Send from '@lucide/svelte/icons/send';
	import Download from '@lucide/svelte/icons/download';
	import X from '@lucide/svelte/icons/x';
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
		type LocalAudioTrack,
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
	let noiseSuppression = $state(true);
	let krispSupported = $state(false);
	let krispProcessor: any = $state(null);

	// VAD (Voice Activity Detection) state
	let vadEnabled = $state(false);
	let vadSpeaking = $state(false);
	let autoMuted = $state(false);
	let audioCtx: AudioContext | null = null;
	let analyser: AnalyserNode | null = null;
	let vadInterval: ReturnType<typeof setInterval> | null = null;
	let silenceTimer = 0;
	let vadDataArray: Uint8Array<ArrayBuffer> | null = null;
	const VAD_THRESHOLD = 15;
	const SILENCE_DURATION = 300;

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
				noiseSuppression = prefs.noiseSuppression ?? true;
				vadEnabled = prefs.vadEnabled ?? false;
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
				noiseSuppression: noiseSuppression,
				vadEnabled: vadEnabled,
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

	function getVolumeIconType(volume: number): 'muted' | 'low' | 'high' {
		if (volume === 0) return 'muted';
		if (volume <= 0.5) return 'low';
		return 'high';
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
		if (room) {
			// Cleanup VAD
			destroyVAD();
			// Cleanup Krisp processor before disconnecting
			if (krispProcessor) {
				try {
					const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
					if (micPub?.track) (micPub.track as LocalAudioTrack).stopProcessor();
				} catch (_) { /* ignore cleanup errors */ }
				krispProcessor = null;
			}
			room.disconnect();
		}
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

		// Initialize Krisp noise filter
		try {
			const { isKrispNoiseFilterSupported, KrispNoiseFilter } = await import('@livekit/krisp-noise-filter');
			if (isKrispNoiseFilterSupported()) {
				krispProcessor = KrispNoiseFilter();
				const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
				if (micPub?.track) {
					await (micPub.track as LocalAudioTrack).setProcessor(krispProcessor);
					await krispProcessor.setEnabled(noiseSuppression);
				}
				krispSupported = true;
			}
		} catch (e) {
			console.warn('Krisp noise filter not available, using browser fallback:', e);
		}

		// Initialize VAD if preference is enabled
		if (vadEnabled) initVAD();

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
		// Cleanup VAD on any disconnect
		destroyVAD();
		// Cleanup Krisp processor on any disconnect
		if (krispProcessor && room) {
			try {
				const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
				if (micPub?.track) (micPub.track as LocalAudioTrack).stopProcessor();
			} catch (_) { /* ignore cleanup errors */ }
			krispProcessor = null;
			krispSupported = false;
		}

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
		// Pause/resume VAD on manual mic toggle
		if (!micEnabled && vadInterval) {
			destroyVAD();
		} else if (micEnabled && vadEnabled && !vadInterval) {
			initVAD();
		}
	}
	
	async function toggleNoiseSuppression() {
		if (!room) return;
		noiseSuppression = !noiseSuppression;
		if (krispSupported && krispProcessor) {
			await krispProcessor.setEnabled(noiseSuppression);
		} else {
			// Fallback: disable/re-enable with constraints (brief audio drop)
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
		savePreferences();
	}

	// VAD Engine
	function initVAD() {
		if (!room || vadInterval) return;
		const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
		if (!micPub?.track) return;

		try {
			audioCtx = new AudioContext();
			const stream = new MediaStream([micPub.track.mediaStreamTrack]);
			const source = audioCtx.createMediaStreamSource(stream);
			analyser = audioCtx.createAnalyser();
			analyser.fftSize = 2048;
			analyser.smoothingTimeConstant = 0.3;
			source.connect(analyser);
			vadDataArray = new Uint8Array(analyser.frequencyBinCount);
			silenceTimer = 0;
			vadInterval = setInterval(checkVoiceActivity, 50);
		} catch (e) {
			console.warn('VAD initialization failed:', e);
		}
	}

	function checkVoiceActivity() {
		if (!vadEnabled || !micEnabled || !analyser || !vadDataArray || !room) return;

		analyser.getByteFrequencyData(vadDataArray);
		let sum = 0;
		for (let i = 0; i < vadDataArray.length; i++) {
			const v = vadDataArray[i];
			sum += v * v;
		}
		const rms = Math.sqrt(sum / vadDataArray.length);

		const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
		if (!micPub) return;

		if (rms >= VAD_THRESHOLD) {
			silenceTimer = 0;
			vadSpeaking = true;
			if (autoMuted) {
				micPub.unmute();
				autoMuted = false;
			}
		} else {
			vadSpeaking = false;
			silenceTimer += 50;
			if (silenceTimer >= SILENCE_DURATION && !autoMuted) {
				micPub.mute();
				autoMuted = true;
			}
		}
	}

	function destroyVAD() {
		if (vadInterval) {
			clearInterval(vadInterval);
			vadInterval = null;
		}
		if (audioCtx) {
			audioCtx.close().catch(() => {});
			audioCtx = null;
		}
		analyser = null;
		vadDataArray = null;
		silenceTimer = 0;
		vadSpeaking = false;
		if (autoMuted && room) {
			const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
			if (micPub) micPub.unmute();
			autoMuted = false;
		}
	}

	async function toggleVAD() {
		vadEnabled = !vadEnabled;
		if (vadEnabled) {
			initVAD();
		} else {
			destroyVAD();
		}
		savePreferences();
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

	function getConnectionQualityIcon(p: Participant): { colorClass: string; title: string } {
		const quality = p.connectionQuality;
		if (quality === ConnectionQuality.Excellent) {
			return { colorClass: 'text-emerald-400', title: 'Excelente' };
		} else if (quality === ConnectionQuality.Good) {
			return { colorClass: 'text-yellow-400', title: 'Buena' };
		} else if (quality === ConnectionQuality.Poor) {
			return { colorClass: 'text-orange-400', title: 'Pobre' };
		}
		return { colorClass: 'text-red-400', title: 'Mala conexión' };
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
		
		console.log('[RolCall] Grabación descargada: audio WebM/Opus. Reproducir con VLC, Chrome, Firefox o Audacity');
		
		// Limpiar
		setTimeout(() => {
			URL.revokeObjectURL(url);
			document.body.removeChild(a);
		}, 100);
		
		recordedChunks = [];
	}

</script>

{#if !joined && !isMaster}
	<main class="grain flex min-h-screen flex-col items-center justify-center px-4">
		<div class="w-full max-w-md text-center">
			<div class="mb-10">
				<div class="mb-4 flex justify-center">
					<Video class="h-16 w-16 text-purple-400 animate-pulse" />
				</div>
				<h1 class="text-5xl font-black text-display text-transparent bg-clip-text bg-gradient-to-br from-purple-300 via-pink-300 to-amber-300">
					Unirse a la sala
				</h1>
				<p class="mt-3 text-lg text-gray-300">Introduce tu nombre para continuar</p>
			</div>
			<div class="brutal-border border-purple-400 text-purple-400 bg-gradient-to-br from-gray-900 to-gray-950 p-8">
				{#if error}
					<div class="mb-5 brutal-border-sm border-red-400 text-red-400 bg-red-950/30 px-4 py-3 text-sm font-semibold">{error}</div>
				{/if}
				<form onsubmit={(e) => { e.preventDefault(); joinRoom(); }}>
				<input type="text" bind:value={playerName} placeholder="Tu nombre" required maxlength={20} aria-label="Nombre de participante"
					class="mb-5 w-full brutal-border-sm border-purple-400/50 bg-gray-800 px-5 py-4 text-center text-xl font-bold text-white placeholder-gray-500 focus:border-purple-400 focus:outline-none focus:ring-0 transition-all" />
					<button type="submit" disabled={connecting || !playerName.trim()}
						aria-label={connecting ? 'Conectando…' : 'Unirse a la sala'}
						class="w-full brutal-border border-purple-400 text-purple-400 bg-purple-600 px-6 py-4 text-xl font-black uppercase tracking-wide text-white dice-shadow transition-all hover:bg-purple-500 hover:translate-x-1.5 hover:translate-y-1.5 hover:shadow-none active:translate-x-2 active:translate-y-2 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500">
						{#if connecting}
							<span class="flex items-center justify-center gap-2">
								<LoaderCircle class="h-6 w-6 animate-spin" />
								Conectando...
							</span>
						{:else}
							<span class="flex items-center justify-center gap-2">
								<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								Unirse
							</span>
						{/if}
					</button>
				</form>
			</div>
		</div>
	</main>

{:else if joined}
	<div class="grain flex h-screen flex-col bg-gray-950">

		<!-- Recording notification with brutal style -->
		{#if recordingNotification}
			<div class="fixed left-1/2 top-16 z-50 -translate-x-1/2 transform brutal-border-sm border-red-400 text-red-400 bg-red-950/90 backdrop-blur-sm px-6 py-4 shadow-2xl">
				<div class="flex items-center gap-3">
					<span class="h-4 w-4 animate-pulse rounded-full bg-red-400"></span>
					<span class="font-black uppercase tracking-wider text-red-200">Grabando sesión</span>
				</div>
			</div>
		{/if}

		{#if downloadNotification}
			<div class="fixed left-1/2 top-16 z-50 -translate-x-1/2 transform brutal-border-sm border-emerald-400 text-emerald-400 bg-emerald-950/90 backdrop-blur-sm px-6 py-4 shadow-2xl">
				<div class="flex flex-col gap-2">
					<div class="flex items-center gap-3">
						<Download class="h-6 w-6 text-emerald-400" />
						<span class="font-black uppercase tracking-wider text-emerald-200">Grabación lista</span>
					</div>
					<span class="text-xs font-bold uppercase text-emerald-300">Audio WebM • Reproducir con VLC o Audacity</span>
				</div>
			</div>
		{/if}

		<header class="flex items-center justify-between border-b-2 border-gray-800 bg-gray-900/80 backdrop-blur-sm px-5 py-3">
			<div class="flex items-center gap-3">
				<svg class="h-6 w-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
				</svg>
				<span class="text-lg font-black uppercase tracking-wider text-gray-100">RolCall</span>
				{#if isMaster}
					<span class="brutal-border-sm border-amber-400 text-amber-400 bg-amber-600 px-3 py-1 text-xs font-black uppercase tracking-wider text-white">Host</span>
				{/if}
			</div>
			<div class="flex items-center gap-3">
				{#if isMaster}
					<button
						onclick={copyLink}
						aria-label={linkCopied ? 'Enlace copiado' : 'Copiar enlace de la sala'}
						class="brutal-border-sm flex items-center gap-2 border-gray-600 bg-gray-800 px-4 py-2 text-sm font-bold uppercase text-gray-300 transition hover:border-gray-400 hover:text-white hover:translate-x-1 hover:translate-y-1 hover:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 {linkCopied ? 'border-emerald-400 text-emerald-400' : 'text-gray-600'}"
					>
						{#if linkCopied}
							<Check class="h-5 w-5" />
							Copiado!
						{:else}
							<Link2 class="h-5 w-5" />
							Enlace
						{/if}
					</button>
				{/if}
				<span class="brutal-border-sm border-purple-500 bg-purple-600 px-3 py-1.5 text-sm font-black uppercase text-white text-purple-500">
					{participants.length}/6
				</span>
			</div>
		</header>

		<div class="flex flex-1 overflow-hidden">
			<div class="flex flex-1 flex-col">
				{#if screenShareTrack}
					<div class="relative flex-1 bg-black">
						<video bind:this={screenShareEl} autoplay playsinline class="h-full w-full object-contain"></video>
						<div class="absolute left-4 top-4 brutal-border-sm border-emerald-400 bg-black/90 backdrop-blur-sm px-4 py-2 text-sm font-black uppercase tracking-wider text-white text-emerald-400">
							<span class="flex items-center gap-2">
								<Monitor class="h-5 w-5 text-emerald-400" />
								{screenShareParticipant}
							</span>
						</div>
						<div class="absolute right-4 top-4 flex items-center gap-3 brutal-border-sm border-gray-700 bg-black/90 backdrop-blur-sm px-4 py-2 text-gray-700">
							<button
								onclick={() => setScreenShareVolume(screenShareVolume === 0 ? 1.0 : 0)}
								aria-label={screenShareVolume === 0 ? 'Activar audio de pantalla' : 'Silenciar audio de pantalla'}
								class="text-white transition hover:text-purple-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
							>
								{#if getVolumeIconType(screenShareVolume) === 'muted'}
									<VolumeX class="h-5 w-5" />
								{:else if getVolumeIconType(screenShareVolume) === 'low'}
									<Volume1 class="h-5 w-5" />
								{:else}
									<Volume2 class="h-5 w-5" />
								{/if}
							</button>
						<input
							type="range"
							min="0"
							max="100"
							value={screenShareVolume * 100}
							oninput={(e) => setScreenShareVolume(e.currentTarget.valueAsNumber / 100)}
							aria-label="Volumen de pantalla compartida"
							class="w-24 accent-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
						/>
						</div>
					</div>
				{/if}

				<div bind:this={videoGrid}
					class="grid flex-1 gap-3 p-3 {screenShareTrack ? 'max-h-40 grid-cols-6' : gridCols(participants.length)}">
					{#each participants as p, i (p.identity)}
						{@const quality = getConnectionQualityIcon(p)}
						{@const isRemote = p !== room?.localParticipant}
						{@const currentVol = participantVolumes.get(p.identity) ?? 1.0}
						<div data-participant={i} class="group relative overflow-hidden brutal-border-sm border-gray-700 bg-gray-900 text-gray-700 {screenShareTrack ? '' : 'aspect-video'} transition-all hover:border-purple-500">
							<video autoplay playsinline muted={p === room?.localParticipant} class="h-full w-full object-cover"></video>
							
							<!-- Indicador de conexión -->
							<div class="absolute right-2 top-2 flex items-center gap-1 brutal-border-sm border-gray-800 bg-black/80 backdrop-blur-sm px-2 py-1 text-gray-800">
								<Wifi class="h-3.5 w-3.5 {quality.colorClass}" title={quality.title} />
							</div>
							
							<div class="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black via-black/80 to-transparent px-3 py-3">
								<span class="flex items-center gap-2 text-sm font-black uppercase text-white">
									{#if p === room?.localParticipant && isMaster}
										<Crown class="h-4 w-4 text-amber-400" />
									{/if}
									{p.name || p.identity}
									{#if p === room?.localParticipant}
										<span class="text-xs text-gray-400 font-normal lowercase">(tú)</span>
									{/if}
								</span>
								<div class="flex items-center gap-1">
									{#if isParticipantMuted(p)}<MicOff class="h-4 w-4 text-red-400" />{/if}
								</div>
							</div>
							{#if isRemote}
								<button
									onclick={() => toggleParticipantMute(p.identity)}
									aria-label={currentVol === 0 ? `Restaurar volumen de ${p.name || p.identity}` : `Silenciar a ${p.name || p.identity}`}
									class="absolute bottom-11 left-2 brutal-border-sm border-gray-700 bg-black/80 backdrop-blur-sm p-1.5 text-white opacity-100 transition hover:border-purple-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 text-gray-700"
								>
									{#if getVolumeIconType(currentVol) === 'muted'}
										<VolumeX class="h-4 w-4" />
									{:else if getVolumeIconType(currentVol) === 'low'}
										<Volume1 class="h-4 w-4" />
									{:else}
										<Volume2 class="h-4 w-4" />
									{/if}
								</button>
								<div class="absolute bottom-11 left-11 right-2 flex items-center opacity-100 transition">
								<input
									type="range"
									min="0"
									max="100"
									value={currentVol * 100}
									oninput={(e) => setParticipantVolume(p.identity, e.currentTarget.valueAsNumber / 100)}
									aria-label="Volumen del participante"
									class="w-full accent-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
								/>
								</div>
							{/if}
							{#if isMaster && isRemote}
								<button
									onclick={() => kickParticipant(p.identity)}
									aria-label="Expulsar a {p.name || p.identity}"
									class="absolute right-2 top-10 brutal-border-sm border-red-500 bg-red-600/90 backdrop-blur-sm p-1.5 text-white opacity-0 transition group-hover:opacity-100 hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:opacity-100 text-red-500"
									title="Expulsar"
								><X class="h-3 w-3" /></button>
							{/if}
						</div>
					{/each}
				</div>

			</div>

			{#if chatOpen}
				<div class="flex w-80 flex-col border-l-2 border-gray-800 bg-gray-900/90 backdrop-blur-sm">
					<div class="flex items-center justify-between border-b-2 border-gray-800 bg-gray-900 px-5 py-4">
						<span class="flex items-center gap-2 text-lg font-black uppercase tracking-wider text-white">
							<MessageSquare class="h-5 w-5 text-purple-400" /> Chat
						</span>
						<button
							onclick={() => (chatOpen = false)}
							aria-label="Cerrar chat"
							class="brutal-border-sm border-gray-600 bg-gray-800 p-1.5 text-gray-400 hover:border-red-400 hover:text-red-400 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 text-gray-600"
						><X class="h-4 w-4" /></button>
					</div>
					<div bind:this={chatContainer} class="flex-1 overflow-y-auto p-4 space-y-4">
						{#each chatMessages as msg}
							<div class="brutal-border-sm border-purple-500/30 bg-gray-800/50 p-3 text-purple-500/30">
								<div class="flex items-baseline gap-2 mb-1">
									<span class="text-sm font-black uppercase text-purple-400">{msg.sender}</span>
									<span class="text-xs font-mono text-gray-500">{msg.time}</span>
								</div>
								<p class="text-sm text-gray-200 font-medium">{msg.text}</p>
							</div>
						{/each}
						{#if chatMessages.length === 0}
							<p class="text-center text-sm font-bold uppercase tracking-wider text-gray-500 mt-8">
								Silencio absoluto...
							</p>
						{/if}
					</div>
					<form onsubmit={(e) => { e.preventDefault(); sendChat(); }} class="flex border-t-2 border-gray-800 bg-gray-900 p-3 gap-2">
					<input type="text" bind:value={chatInput} placeholder="Escribe un mensaje..." maxlength={500} aria-label="Mensaje de chat"
						class="flex-1 brutal-border-sm border-gray-600 bg-gray-800 px-4 py-2.5 text-sm font-medium text-white placeholder-gray-500 focus:border-purple-400 focus:outline-none text-gray-600" />
						<button
							type="submit"
							disabled={!chatInput.trim()}
							aria-label="Enviar mensaje"
							class="brutal-border-sm border-purple-500 bg-purple-600 px-4 py-2.5 text-sm text-white hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 text-purple-500 hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition"
						><Send class="h-4 w-4" /></button>
					</form>
				</div>
			{/if}
		</div>

		<div class="flex items-center justify-center gap-2 border-t-2 border-gray-800 bg-gray-900/90 backdrop-blur-sm px-4 py-4">
			<div class="relative">
				<button
					onclick={toggleMic}
					aria-label={micEnabled ? 'Silenciar micrófono' : 'Activar micrófono'}
					class="brutal-border-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 {micEnabled ? 'border-gray-600 bg-gray-700 hover:border-gray-500 hover:bg-gray-600 text-white text-gray-600' : 'border-red-500 bg-red-600 hover:bg-red-500 text-white text-red-500'} p-3 hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
				>{#if micEnabled}<Mic class="h-5 w-5" />{:else}<MicOff class="h-5 w-5" />{/if}</button>
				{#if vadEnabled}<span class="absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-gray-900 {vadSpeaking ? 'bg-emerald-400' : 'bg-gray-600'}"></span>{/if}
			</div>
			<button
				onclick={toggleNoiseSuppression}
				aria-label={noiseSuppression ? 'Desactivar reducción de ruido' : 'Activar reducción de ruido'}
				title={noiseSuppression ? (krispSupported ? 'Reducción profesional (activa)' : 'Reducción básica') : 'Sin reducción'}
				class="brutal-border-sm p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 {noiseSuppression ? 'border-emerald-500 bg-emerald-600 hover:bg-emerald-500 text-emerald-500' : 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-600'} text-white hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
			>{#if noiseSuppression}<AudioWaveform class="h-5 w-5" />{:else}<Volume2 class="h-5 w-5" />{/if}</button>
			<button
				onclick={toggleVAD}
				aria-label={vadEnabled ? 'Desactivar auto-silencio' : 'Activar auto-silencio'}
				class="brutal-border-sm p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 {vadEnabled ? 'border-purple-500 bg-purple-600 hover:bg-purple-500 text-purple-500' : 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-600'} text-white hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
			><Activity class="h-5 w-5" /></button>
			<button
				onclick={toggleCam}
				aria-label={camEnabled ? 'Desactivar cámara' : 'Activar cámara'}
				class="brutal-border-sm p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 {camEnabled ? 'border-gray-600 bg-gray-700 hover:border-gray-500 hover:bg-gray-600 text-white text-gray-600' : 'border-red-500 bg-red-600 hover:bg-red-500 text-white text-red-500'} hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
			>{#if camEnabled}<Video class="h-5 w-5" />{:else}<VideoOff class="h-5 w-5" />{/if}</button>
			
			<!-- Background filter button with dropdown -->
			<div class="relative">
				<button
					onclick={() => backgroundMenuOpen = !backgroundMenuOpen}
					aria-label="Fondo virtual"
					aria-expanded={backgroundMenuOpen}
					class="brutal-border-sm p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 {backgroundMode !== 'none' ? 'border-amber-500 bg-amber-600 hover:bg-amber-500 text-amber-500' : 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-600'} text-white hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
				><Sparkles class="h-5 w-5" /></button>
				
				{#if backgroundMenuOpen}
					<div class="absolute bottom-full mb-2 right-0 w-64 brutal-border-sm border-gray-600 bg-gray-800 text-gray-600 p-3 shadow-2xl backdrop-blur-sm">
						<div class="text-xs font-black uppercase tracking-wider text-gray-400 px-2 py-2">Filtros de fondo</div>
						<button
							onclick={setBackgroundNone}
							aria-label="Sin filtro de fondo"
							class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-bold text-white hover:bg-gray-700 transition {backgroundMode === 'none' ? 'bg-gray-700 text-purple-400' : ''}"
						><Ban class="h-5 w-5" /> Sin filtro</button>
						<button
							onclick={setBackgroundBlur}
							aria-label="Difuminar fondo"
							class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-bold text-white hover:bg-gray-700 transition {backgroundMode === 'blur' ? 'bg-gray-700 text-purple-400' : ''}"
						><Blend class="h-5 w-5" /> Desenfocar</button>
						<button
							onclick={() => backgroundImageInput.click()}
							aria-label="Imagen personalizada de fondo"
							class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-bold text-white hover:bg-gray-700 transition {backgroundMode === 'image' ? 'bg-gray-700 text-purple-400' : ''}"
						><ImageIcon class="h-5 w-5" /> Imagen personalizada</button>
						<input bind:this={backgroundImageInput} type="file" accept="image/*" onchange={handleBackgroundImageUpload} class="hidden" />
					</div>
				{/if}
			</div>

			{#if isMaster}
				<button
					onclick={toggleScreenShare}
					aria-label={screenSharing ? 'Dejar de compartir pantalla' : 'Compartir pantalla'}
					class="brutal-border-sm p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 {screenSharing ? 'border-emerald-500 bg-emerald-600 hover:bg-emerald-500 text-white text-emerald-500' : 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-white text-gray-600'} hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
				><Monitor class="h-5 w-5" /></button>
				<button
					onclick={toggleRecording}
					aria-label={isRecording ? 'Detener grabación' : 'Iniciar grabación'}
					class="brutal-border-sm p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 {isRecording ? 'border-red-500 bg-red-600 hover:bg-red-500 animate-pulse text-white text-red-500' : 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-white text-gray-600'} hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
				><Circle class="h-5 w-5 {isRecording ? 'fill-current' : ''}" /></button>
			{/if}
			<button
				onclick={() => (chatOpen = !chatOpen)}
				aria-label={chatOpen ? 'Cerrar chat' : 'Abrir chat'}
				class="brutal-border-sm p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 {chatOpen ? 'border-purple-500 bg-purple-600 hover:bg-purple-500 text-purple-500' : 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-600'} text-white hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
			><MessageSquare class="h-5 w-5" /></button>
			<div class="mx-2 h-10 w-0.5 bg-gray-700"></div>
			{#if isMaster}
				<button
					onclick={closeRoom}
					aria-label="Cerrar sala"
					class="brutal-border-sm border-red-500 bg-red-700 p-3 text-white transition hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 text-red-500 hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
				><LogOut class="h-5 w-5" /></button>
			{:else}
				<button
					onclick={leaveRoom}
					aria-label="Salir de la sala"
					class="brutal-border-sm border-red-500 bg-red-700 p-3 text-white transition hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 text-red-500 hover:translate-x-1 hover:translate-y-1 hover:shadow-none"
				><PhoneOff class="h-5 w-5" /></button>
			{/if}
		</div>
	</div>

{:else}
	<main class="grain flex min-h-screen items-center justify-center">
		<div class="text-center">
			<div class="mb-6 flex justify-center">
				<LoaderCircle class="h-16 w-16 text-purple-400 animate-spin" />
			</div>
			<p class="text-2xl font-black uppercase tracking-wider text-gray-300">Conectando...</p>
			{#if error}
				<div class="mt-6 brutal-border-sm border-red-400 text-red-400 bg-red-950/30 px-6 py-4 text-sm font-semibold max-w-md mx-auto">{error}</div>
			<a
				href="/"
				aria-label="Volver al inicio"
				class="mt-6 inline-block brutal-border-sm border-purple-400 text-purple-400 bg-purple-600 px-6 py-3 text-sm font-bold uppercase text-white hover:bg-purple-500 hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
			>Volver al inicio</a>
			{/if}
		</div>
	</main>
{/if}
