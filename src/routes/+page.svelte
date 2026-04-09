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
			await goto(`/sala/${roomId}?role=master&name=Anfitrión`);
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Error desconocido';
			loading = false;
		}
	}
</script>

<main class="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-16">
	<!-- Subtle background accent -->
	<div class="pointer-events-none absolute inset-0 overflow-hidden">
		<div class="absolute -left-48 -top-48 h-96 w-96 rounded-full bg-indigo-600/10 blur-3xl"></div>
		<div class="absolute -bottom-48 -right-48 h-96 w-96 rounded-full bg-indigo-600/10 blur-3xl"></div>
	</div>

	<div class="relative z-10 w-full max-w-md">
		<!-- Header -->
		<header class="mb-10 text-center">
			<div class="mb-5 inline-flex items-center justify-center rounded-2xl bg-indigo-600 p-3.5 shadow-lg shadow-indigo-600/20">
				<svg class="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
				</svg>
			</div>
			<h1 class="mb-2 text-4xl font-bold tracking-tight text-white">
				RolCall
			</h1>
			<p class="text-base text-gray-400">Videollamadas grupales, sin registro ni instalaciones</p>
		</header>

		<!-- Main card -->
		<div class="rounded-2xl border border-gray-800 bg-gray-900 p-8 shadow-xl">
			<div class="mb-7 text-center">
				<h2 class="mb-1.5 text-xl font-semibold text-white">Crea una sala</h2>
				<p class="text-sm text-gray-400">
					Empieza la llamada y comparte el enlace con los invitados
				</p>
			</div>

			{#if error}
				<div class="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
					<svg class="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					{error}
				</div>
			{/if}

			<button
				onclick={createRoom}
				disabled={loading}
				class="w-full rounded-xl bg-indigo-600 px-6 py-3.5 text-base font-semibold text-white shadow-md shadow-indigo-600/20 transition-all duration-150 hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
			>
				<span class="flex items-center justify-center gap-2">
					{#if loading}
						<svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						Creando sala...
					{:else}
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
						</svg>
						Crear sala
					{/if}
				</span>
			</button>

			<div class="mt-6 border-t border-gray-800 pt-5">
				<p class="text-center text-sm text-gray-500">
					¿Te invitaron a una sala? Pide el enlace al anfitrión.
				</p>
			</div>
		</div>

		<!-- Feature pills -->
		<div class="mt-6 grid grid-cols-3 gap-3">
			<div class="rounded-xl border border-gray-800 bg-gray-900/60 px-3 py-4 text-center">
				<div class="mb-2 flex justify-center">
					<svg class="h-5 w-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
					</svg>
				</div>
				<p class="text-xs font-medium text-gray-400">Video HD</p>
			</div>
			<div class="rounded-xl border border-gray-800 bg-gray-900/60 px-3 py-4 text-center">
				<div class="mb-2 flex justify-center">
					<svg class="h-5 w-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
					</svg>
				</div>
				<p class="text-xs font-medium text-gray-400">Pantalla compartida</p>
			</div>
			<div class="rounded-xl border border-gray-800 bg-gray-900/60 px-3 py-4 text-center">
				<div class="mb-2 flex justify-center">
					<svg class="h-5 w-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
					</svg>
				</div>
				<p class="text-xs font-medium text-gray-400">Chat</p>
			</div>
		</div>

		<!-- Trust badges -->
		<div class="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-gray-600">
			<span class="flex items-center gap-1.5">
				<svg class="h-3.5 w-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
					<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
				</svg>
				Sin registro
			</span>
			<span class="flex items-center gap-1.5">
				<svg class="h-3.5 w-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
					<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
				</svg>
				Hasta 6 personas
			</span>
			<span class="flex items-center gap-1.5">
				<svg class="h-3.5 w-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
					<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
				</svg>
				Gratis
			</span>
		</div>
	</div>

	<footer class="relative z-10 mt-10 text-center text-xs text-gray-700">
		<p>Sin registro · Sin instalaciones · Sin complicaciones</p>
	</footer>
</main>
