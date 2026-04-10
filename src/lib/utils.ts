/**
 * Returns the initials for a participant's display name.
 *
 * - Splits on spaces and hyphens
 * - Takes the first character of the first two words, uppercased
 * - Single word (or no split) → returns first 2 characters uppercased
 * - Single character name → returns that character uppercased
 *
 * @example
 * getInitials("Juan Pablo") // "JP"
 * getInitials("María-José") // "MJ"
 * getInitials("Aragorn")    // "AR"
 * getInitials("A")          // "A"
 */
export function getInitials(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return '?';

	const words = trimmed.split(/[\s-]+/).filter((w) => w.length > 0);

	if (words.length >= 2) {
		return (words[0][0] + words[1][0]).toUpperCase();
	}

	// Single word: take first 2 chars (or 1 if shorter)
	return trimmed.slice(0, 2).toUpperCase();
}
