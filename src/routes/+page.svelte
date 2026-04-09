<script lang="ts">
	import { goto } from '$app/navigation';

	let loading = $state(false);
	let error = $state('');

	async function createRoom() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/create-room', { method: 'POST' });
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error ?? 'Error al crear la sala');
			}
			const { roomId } = await res.json();
			await goto(`/sala/${roomId}?role=master&name=Master`);
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Error desconocido';
			loading = false;
		}
	}
</script>

<main class="flex min-h-screen flex-col items-center justify-center px-4">
	<div class="w-full max-w-md text-center">
		<!-- Logo / Title -->
		<div class="mb-8">
			<div class="mb-4 flex items-center justify-center gap-3">
				<span class="text-5xl">🎲</span>
				<h1 class="text-5xl font-bold tracking-tight text-white">RolCall</h1>
			</div>
			<p class="text-lg text-gray-400">Llamadas de voz y vídeo para tus partidas de rol online</p>
		</div>

		<!-- Card -->
		<div class="rounded-2xl border border-gray-800 bg-gray-900 p-8 shadow-2xl">
			<h2 class="mb-2 text-2xl font-semibold text-white">¡Bienvenido, Maestro!</h2>
			<p class="mb-8 text-gray-400">
				Crea una sala y comparte el enlace con tus jugadores para empezar la partida.
			</p>

			{#if error}
				<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
					{error}
				</div>
			{/if}

			<button
				onclick={createRoom}
				disabled={loading}
				class="w-full rounded-xl bg-indigo-600 px-6 py-4 text-lg font-semibold text-white transition-all hover:bg-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
			>
				{#if loading}
					<span class="flex items-center justify-center gap-2">
						<svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						Creando sala…
					</span>
				{:else}
					🏰 Crear sala
				{/if}
			</button>

			<p class="mt-6 text-sm text-gray-500">
				¿Eres jugador? Pide el enlace al Maestro de Juego.
			</p>
		</div>

		<!-- Features -->
		<div class="mt-8 grid grid-cols-3 gap-4 text-center text-sm text-gray-500">
			<div class="rounded-xl border border-gray-800 bg-gray-900 p-4">
				<div class="mb-1 text-2xl">🎙️</div>
				<div>Voz y vídeo</div>
			</div>
			<div class="rounded-xl border border-gray-800 bg-gray-900 p-4">
				<div class="mb-1 text-2xl">🖥️</div>
				<div>Compartir pantalla</div>
			</div>
			<div class="rounded-xl border border-gray-800 bg-gray-900 p-4">
				<div class="mb-1 text-2xl">💬</div>
				<div>Chat en partida</div>
			</div>
		</div>
	</div>
</main>
