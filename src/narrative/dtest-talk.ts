/**
 * The conversation pipeline of the `?dialogue=test` demo: the real DialogueRunner (src/narrative/Dialogue.ts)
 * with the demo's DialogueHost, the bottom DialoguePanel (src/ui/DialoguePanel.ts) and the world-space
 * SpeechBubbles (src/narrative/SpeechBubbles.ts), all talking through the 'dialogue:*' events of
 * DialogueTypes.ts. The sample graph is `test_evangelist` from content/dialogue/test.json.
 */
import type * as THREE from 'three';
import { DialogueRunner, findDialogue, type DialogueGraph } from './Dialogue';
import { SpeechBubbles } from './SpeechBubbles';
import { DialoguePanel } from '../ui/DialoguePanel';
import type { DemoHost } from './dtest-host';

/** The sample conversation (its file is content/dialogue/test.json). */
export const SAMPLE_GRAPH = 'test_evangelist';

/** The sample graph (loaded, parsed and, in dev, validated by the registry), or null when it is missing. */
export function loadSampleGraph(): Promise<DialogueGraph | null> {
  return findDialogue(SAMPLE_GRAPH);
}

export class DemoTalk {
  private readonly runner: DialogueRunner;
  private readonly panel: DialoguePanel;
  private readonly bubbles: SpeechBubbles;
  private graph: DialogueGraph | null = null;
  private disposed = false;

  constructor(
    private readonly host: DemoHost,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    // Registered as 'dialogue' and 'bubbles' (the panel finds the bubbles through the service); both unregister
    // themselves on dispose. The demo is not gameplay, so the panel leaves gameplay input off afterwards.
    this.runner = new DialogueRunner(host);
    this.bubbles = new SpeechBubbles(camera);
    this.panel = new DialoguePanel(this.runner, { restoreGameplay: false }); // bubble lines use runner.actor()
  }

  setGraph(graph: DialogueGraph | null): void {
    this.graph = graph;
  }

  get active(): boolean {
    return this.runner.active;
  }

  /** Plays the sample; resolves when it ends (or at once when there is no sample). */
  async play(): Promise<void> {
    if (this.disposed || !this.graph) return;
    this.host.beginConversation();
    await this.runner.play(this.graph);
  }

  stop(): void {
    this.runner.stop();
  }

  /** Per rendered frame, after the camera moved: bubbles follow the speakers' heads. */
  update(): void {
    this.bubbles.update(this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runner.stop();
    this.bubbles.dispose();
    this.panel.dispose();
    this.runner.dispose();
  }
}
