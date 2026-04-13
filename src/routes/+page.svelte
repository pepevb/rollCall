<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let loading = $state(false);
	let error = $state('');
	let lastRoomId = $state<string | null>(null);

	onMount(() => {
		if (typeof window !== 'undefined') {
			lastRoomId = localStorage.getItem('rolcall-lastRoomId');
		}
	});

	async function continueLastRoom() {
		if (!lastRoomId) return;
		await createOrJoinRoom(lastRoomId);
	}

	async function createNewRoom() {
		await createOrJoinRoom(null);
	}

	async function createOrJoinRoom(roomId: string | null) {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/create-room', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ roomId })
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error ?? 'Error al crear la sala');
			}
			const { roomId: finalRoomId } = await res.json();
			
			if (typeof window !== 'undefined') {
				localStorage.setItem('rolcall-lastRoomId', finalRoomId);
			}
			
			await goto(`/sala/${finalRoomId}?role=master&name=Anfitrión`);
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Error desconocido';
			loading = false;
		}
	}
</script>

<main class="grain relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-16">
	<!-- Dramatic background with dice-inspired colors -->
	<div class="pointer-events-none absolute inset-0 overflow-hidden">
		<div class="absolute -left-64 top-0 h-[600px] w-[600px] rounded-full bg-purple-600/20 blur-[100px] animate-float"></div>
		<div class="absolute -right-64 bottom-0 h-[500px] w-[500px] rounded-full bg-emerald-500/15 blur-[100px] animate-float" style="animation-delay: -1s;"></div>
		<div class="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/10 blur-[80px] animate-float" style="animation-delay: -2s;"></div>
	</div>

	<div class="relative z-10 w-full max-w-lg">
		<!-- Header -->
		<header class="mb-12 text-center">
			<div class="mb-6 inline-flex items-center justify-center">
				<!-- Video call icon -->
				<svg class="h-20 w-20 text-purple-400 animate-dice-roll" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
				</svg>
			</div>
			<h1 class="mb-3 text-6xl font-black text-display text-transparent bg-clip-text bg-gradient-to-br from-purple-300 via-pink-300 to-amber-300">
				RolCall
			</h1>
			<p class="text-lg text-gray-300 font-normal">Videollamadas grupales sin complicaciones</p>
		</header>

		<!-- Main card with brutal style -->
		<div class="brutal-border border-purple-400 rounded-none bg-gradient-to-br from-gray-900 to-gray-950 p-8 shadow-2xl text-purple-400 transition-all duration-300 hover:shadow-purple-500/20">
			<div class="mb-8 text-center">
				<h2 class="mb-2 text-3xl font-bold text-display text-white">Crea una sala</h2>
				<p class="text-sm text-gray-300">
					Empieza la llamada y comparte el enlace con los invitados
				</p>
			</div>

			{#if error}
				<div class="mb-6 brutal-border-sm border-red-400 text-red-400 flex items-start gap-3 bg-red-950/30 px-4 py-3 text-sm">
					<svg class="mt-0.5 h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<span class="font-semibold">{error}</span>
				</div>
			{/if}

			{#if lastRoomId}
				<div class="mb-5 brutal-border-sm border-emerald-400 text-emerald-400 bg-emerald-950/20 px-4 py-3">
					<p class="mb-1 text-sm font-bold uppercase tracking-wider">Sala activa</p>
					<p class="font-mono text-xs opacity-80">{lastRoomId}</p>
				</div>

			<button
				onclick={continueLastRoom}
				disabled={loading}
				aria-label="Continuar con la última sala creada"
				class="w-full brutal-border-sm border-emerald-400 text-emerald-400 bg-emerald-600 px-6 py-4 text-lg font-bold uppercase tracking-wide text-white transition-all duration-150 hover:bg-emerald-500 hover:translate-x-1 hover:translate-y-1 hover:shadow-none active:translate-x-1.5 active:translate-y-1.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
			>
					<span class="flex items-center justify-center gap-2">
						{#if loading}
							<svg class="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24" stroke-width="2.5">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
							</svg>
							Abriendo sala...
						{:else}
							<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
							Continuar sala
						{/if}
					</span>
				</button>

			<div class="my-6 flex items-center gap-4">
				<div class="h-0.5 flex-1 bg-gradient-to-r from-transparent via-purple-500/30 to-transparent"></div>
				<span class="text-xs font-bold uppercase text-purple-300">o</span>
				<div class="h-0.5 flex-1 bg-gradient-to-r from-transparent via-purple-500/30 to-transparent"></div>
			</div>

			<button
				onclick={createNewRoom}
				disabled={loading}
				aria-label="Crear sala nueva"
				class="w-full brutal-border-sm border-gray-600 text-gray-600 bg-gray-800 px-6 py-3.5 text-base font-bold uppercase tracking-wide text-gray-200 transition-all duration-150 hover:bg-gray-700 hover:text-white hover:border-white hover:translate-x-1 hover:translate-y-1 hover:shadow-none active:translate-x-1.5 active:translate-y-1.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
			>
					<span class="flex items-center justify-center gap-2">
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
						</svg>
						Nueva sala
					</span>
				</button>
			{:else}
			<button
				onclick={createNewRoom}
				disabled={loading}
				aria-label="Crear sala nueva"
				class="w-full brutal-border border-purple-400 text-purple-400 bg-purple-600 px-6 py-5 text-xl font-black uppercase tracking-wide text-white dice-shadow transition-all duration-150 hover:bg-purple-500 hover:translate-x-1.5 hover:translate-y-1.5 hover:shadow-none active:translate-x-2 active:translate-y-2 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
			>
					<span class="flex items-center justify-center gap-3">
						{#if loading}
							<svg class="h-7 w-7 animate-spin" fill="none" viewBox="0 0 24 24" stroke-width="3">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
							</svg>
							Creando sala...
						{:else}
							<svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
							</svg>
							Crear sala
						{/if}
					</span>
				</button>
			{/if}

		<div class="mt-6 border-t-2 border-gray-700/50 pt-6">
			<p class="text-center text-sm text-gray-300 font-semibold">
				¿Te invitaron? Pide el enlace al <span class="text-amber-400">anfitrión</span>
			</p>
		</div>
		</div>

		<!-- Feature cards with RPG theme -->
		<div class="mt-8 grid grid-cols-3 gap-4">
			<div class="brutal-border-sm border-purple-500/50 text-purple-500/50 bg-gray-900/80 backdrop-blur-sm px-3 py-5 text-center transition-all hover:border-purple-400 hover:text-purple-400 hover:translate-x-1 hover:translate-y-1 hover:shadow-none">
				<div class="mb-3 flex justify-center">
					<svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
					</svg>
				</div>
				<p class="text-xs font-bold uppercase">Video HD</p>
			</div>
			<div class="brutal-border-sm border-emerald-500/50 text-emerald-500/50 bg-gray-900/80 backdrop-blur-sm px-3 py-5 text-center transition-all hover:border-emerald-400 hover:text-emerald-400 hover:translate-x-1 hover:translate-y-1 hover:shadow-none">
				<div class="mb-3 flex justify-center">
					<svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
					</svg>
				</div>
				<p class="text-xs font-bold uppercase">Compartir</p>
			</div>
			<div class="brutal-border-sm border-amber-500/50 text-amber-500/50 bg-gray-900/80 backdrop-blur-sm px-3 py-5 text-center transition-all hover:border-amber-400 hover:text-amber-400 hover:translate-x-1 hover:translate-y-1 hover:shadow-none">
				<div class="mb-3 flex justify-center">
					<svg class="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
					</svg>
				</div>
				<p class="text-xs font-bold uppercase">Chat</p>
			</div>
		</div>

		<!-- Stats -->
		<div class="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-bold uppercase tracking-wide text-gray-400">
			<span class="flex items-center gap-2">
				<span class="h-2 w-2 rounded-full bg-emerald-400"></span>
				Sin registro
			</span>
			<span class="flex items-center gap-2">
				<span class="h-2 w-2 rounded-full bg-purple-400"></span>
				Hasta 6 personas
			</span>
			<span class="flex items-center gap-2">
				<span class="h-2 w-2 rounded-full bg-amber-400"></span>
				Gratis
			</span>
		</div>
	</div>

	<footer class="relative z-10 mt-12 text-center">
		<p class="text-sm font-bold uppercase tracking-widest text-gray-600">
			Sin registro <span class="text-purple-500">·</span> Sin instalaciones <span class="text-purple-500">·</span> Sin complicaciones
		</p>
	</footer>
</main>
