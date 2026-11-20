/** JSON.parse qui renvoie undefined pour un texte qui n'est pas du JSON (PDF déposé, page d'erreur…). */
export function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
