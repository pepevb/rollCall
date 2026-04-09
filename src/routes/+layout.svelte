<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<svelte:head>
	<title>RolCall</title>
	<meta name="description" content="Llamadas de voz y vídeo para partidas de rol online" />
</svelte:head>

<div class="min-h-screen bg-gray-950 text-gray-100">
	{@render children()}
</div>
