/**
 * DOM tiruan untuk menguji adapter di Node.
 *
 * Kenapa ditulis sendiri alih-alih memakai jsdom: adapter bekerja pada antarmuka
 * `DocumentLike` dan `ElementLike` yang dipersempit, sehingga yang perlu diuji adalah
 * **logika** adapter — urutan prioritas selector, penggabungan elemen bersarang,
 * penanganan nama yang tidak ada. Semuanya dapat diuji dengan DOM tiruan, tanpa
 * menambah dependensi besar dan tanpa browser.
 *
 * Yang **tidak** dapat diuji dengan cara ini adalah apakah selector-nya benar untuk
 * Gmail sungguhan. Itu diverifikasi skrip konsol terhadap halaman asli, dan pemisahan
 * itu disengaja.
 *
 * Mesin selector di bawah ini sengaja minimal: hanya bentuk yang benar-benar dipakai
 * adapter — nama tag, kelas, `[attr]`, `[attr="nilai"]`, `[attr*="nilai"]`,
 * penggabungan, daftar berkoma, dan combinator keturunan.
 */
import type { DocumentLike, ElementLike } from '../src/types.ts';

export interface ElementInit {
  readonly tag: string;
  readonly attrs?: Readonly<Record<string, string>>;
  /** Teks milik elemen ini sendiri, bukan milik anaknya. */
  readonly text?: string;
  readonly children?: readonly ElementInit[];
}

interface AttributeTest {
  readonly name: string;
  readonly operator: 'exists' | 'equals' | 'contains';
  readonly value: string;
}

interface Compound {
  readonly tag: string | null;
  readonly classes: readonly string[];
  readonly attributes: readonly AttributeTest[];
}

/**
 * Selector dengan kurung siku tidak seimbang ditiru sebagai kesalahan, supaya jalur
 * penanganan kesalahan di adapter benar-benar teruji dan bukan sekadar diandaikan aman.
 */
function assertBalancedSelector(selector: string): void {
  const opens = (selector.match(/\[/g) ?? []).length;
  const closes = (selector.match(/\]/g) ?? []).length;
  if (opens !== closes) throw new Error(`selector tidak valid: ${selector}`);
}

export class FakeElement implements ElementLike {
  readonly tag: string;
  readonly ownText: string;
  readonly children: FakeElement[];
  parentElement: FakeElement | null;
  private readonly attributes: Map<string, string>;

  constructor(init: ElementInit) {
    this.tag = init.tag.toLowerCase();
    this.ownText = init.text ?? '';
    this.attributes = new Map(Object.entries(init.attrs ?? {}));
    this.parentElement = null;
    this.children = (init.children ?? []).map((child) => {
      const element = new FakeElement(child);
      element.parentElement = this;
      return element;
    });
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  get classList(): string[] {
    return (this.attributes.get('class') ?? '').split(/\s+/).filter((part) => part.length > 0);
  }

  get textContent(): string {
    const parts = [this.ownText];
    for (const child of this.children) parts.push(child.textContent);
    return parts.join('');
  }

  closest(selector: string): FakeElement | null {
    let current: FakeElement | null = this;
    while (current !== null) {
      if (matchesElement(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  /** Elemen ini sendiri dan seluruh keturunannya, urutan dokumen. */
  private descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (element: FakeElement): void => {
      out.push(element);
      for (const child of element.children) walk(child);
    };
    walk(this);
    return out;
  }

  querySelectorAll(selector: string): ArrayLike<ElementLike> {
    assertBalancedSelector(selector);
    return this.descendants().filter((element) => matchesElement(element, selector));
  }
}

// ---------------------------------------------------------------------------
// Mesin selector minimal
// ---------------------------------------------------------------------------

function parseCompound(source: string): Compound {
  const attributes: AttributeTest[] = [];
  const classes: string[] = [];

  // Atribut
  const withoutAttributes = source.replace(
    /\[([A-Za-z0-9_-]+)(?:(\^=|\*=|=)"([^"]*)")?\]/g,
    (_whole, name: string, operator: string | undefined, value: string | undefined) => {
      if (operator === undefined) {
        attributes.push({ name, operator: 'exists', value: '' });
      } else if (operator === '=') {
        attributes.push({ name, operator: 'equals', value: value ?? '' });
      } else {
        attributes.push({ name, operator: 'contains', value: value ?? '' });
      }
      return '';
    },
  );

  // Kelas
  const withoutClasses = withoutAttributes.replace(/\.([A-Za-z0-9_-]+)/g, (_whole, name: string) => {
    classes.push(name);
    return '';
  });

  const tag = withoutClasses.trim().length > 0 ? withoutClasses.trim().toLowerCase() : null;

  return { tag, classes, attributes };
}

function matchesCompound(element: FakeElement, compound: Compound): boolean {
  if (compound.tag !== null && compound.tag !== '*' && element.tag !== compound.tag) return false;

  const elementClasses = element.classList;
  for (const required of compound.classes) {
    if (!elementClasses.includes(required)) return false;
  }

  for (const test of compound.attributes) {
    const value = element.getAttribute(test.name);
    if (test.operator === 'exists') {
      if (value === null) return false;
    } else if (test.operator === 'equals') {
      if (value !== test.value) return false;
    } else if (value === null || !value.includes(test.value)) {
      return false;
    }
  }

  return true;
}

/** Mencocokkan satu elemen terhadap selector penuh, termasuk daftar berkoma. */
export function matchesElement(element: FakeElement, selector: string): boolean {
  for (const alternative of selector.split(',')) {
    const trimmed = alternative.trim();
    if (trimmed.length === 0) continue;

    // Combinator keturunan: "A B" berarti B yang memiliki leluhur A.
    const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);
    const last = parts[parts.length - 1];
    if (last === undefined) continue;
    if (!matchesCompound(element, parseCompound(last))) continue;

    let ancestor = element.parentElement;
    let remaining = parts.length - 2;
    let ok = true;

    while (remaining >= 0) {
      const part = parts[remaining];
      if (part === undefined) break;

      let found = false;
      while (ancestor !== null) {
        if (matchesCompound(ancestor, parseCompound(part))) {
          found = true;
          ancestor = ancestor.parentElement;
          break;
        }
        ancestor = ancestor.parentElement;
      }

      if (!found) {
        ok = false;
        break;
      }
      remaining--;
    }

    if (ok) return true;
  }

  return false;
}

export class FakeDocument implements DocumentLike {
  readonly roots: FakeElement[];

  constructor(roots: readonly ElementInit[]) {
    this.roots = roots.map((init) => new FakeElement(init));
  }

  private all(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (element: FakeElement): void => {
      out.push(element);
      for (const child of element.children) walk(child);
    };
    for (const root of this.roots) walk(root);
    return out;
  }

  querySelectorAll(selector: string): ArrayLike<ElementLike> {
    assertBalancedSelector(selector);

    return this.all().filter((element) => matchesElement(element, selector));
  }

  querySelector(selector: string): ElementLike | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

/** Membungkus daftar elemen menjadi dokumen tiruan. */
export function fakeDocument(...roots: readonly ElementInit[]): FakeDocument {
  return new FakeDocument(roots);
}
