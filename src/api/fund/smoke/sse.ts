// Abonnement au flux SSE de l'API (comme le ferait un EventSource du navigateur), avec comptage par type.

const EVENT_LINE_PREFIX = "event: ";
const EVENT_SEPARATOR = "\n\n";

export class EventCounter {
  readonly counts = new Map<string, number>();
  private readonly controller = new AbortController();
  private reading: Promise<void> | undefined;

  async connect(url: string): Promise<void> {
    const response = await fetch(url, { signal: this.controller.signal, headers: { Accept: "text/event-stream" } });
    if (!response.ok || response.body === null) throw new Error(`SSE ${url} : statut ${response.status}`);
    this.reading = this.read(response.body);
  }

  total(): number {
    return [...this.counts.values()].reduce((sum, count) => sum + count, 0);
  }

  async close(): Promise<void> {
    this.controller.abort();
    await this.reading?.catch((error: unknown) => {
      if (!(error instanceof Error && error.name === "AbortError")) throw error;
    });
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end = buffer.indexOf(EVENT_SEPARATOR);
      while (end >= 0) {
        this.count(buffer.slice(0, end));
        buffer = buffer.slice(end + EVENT_SEPARATOR.length);
        end = buffer.indexOf(EVENT_SEPARATOR);
      }
    }
  }

  private count(block: string): void {
    const line = block.split("\n").find((candidate) => candidate.startsWith(EVENT_LINE_PREFIX));
    if (line === undefined) return; // commentaire (ping)
    const type = line.slice(EVENT_LINE_PREFIX.length);
    this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
  }
}
