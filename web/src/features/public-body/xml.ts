// Lecteur XML minimal et pur (navigateur et Node) : arbre d'éléments par nom local, texte décodé, sans DTD.

export class XmlSyntaxError extends Error {}

export interface XmlElement {
  /** Nom local, sans préfixe d'espace de noms. */
  name: string;
  children: XmlElement[];
  /** Texte direct de l'élément, entités et CDATA décodés. */
  text: string;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const ENTITY = /&([^;&\s]*);?/g;
const TAG_NAME = /^[^\s/>]+/;

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (match, body: string) => {
    if (!match.endsWith(";")) throw new XmlSyntaxError(`Unterminated entity: ${match}`);
    if (body in NAMED_ENTITIES) return NAMED_ENTITIES[body];
    const code = body.startsWith("#x") ? Number.parseInt(body.slice(2), 16) : body.startsWith("#") ? Number(body.slice(1)) : NaN;
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) throw new XmlSyntaxError(`Unknown entity: ${match}`);
    return String.fromCodePoint(code);
  });
}

/** Fin d'une balise ouvrante : premier `>` hors des valeurs d'attribut entre guillemets. */
function tagEnd(source: string, from: number): number {
  let quote: string | undefined;
  for (let index = from; index < source.length; index++) {
    const char = source[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  throw new XmlSyntaxError("Unterminated tag");
}

function skipPast(source: string, from: number, terminator: string): number {
  const end = source.indexOf(terminator, from);
  if (end < 0) throw new XmlSyntaxError(`Missing ${terminator}`);
  return end + terminator.length;
}

/** Racine d'un document bien formé ; les DOCTYPE sont refusés (aucune entité déclarée n'est développée). */
export function parseXml(source: string): XmlElement {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const open: { qualified: string; element: XmlElement }[] = [];
  let root: XmlElement | undefined;
  let index = 0;
  while (index < text.length) {
    const current = open.at(-1)?.element;
    if (text[index] !== "<") {
      const next = text.indexOf("<", index);
      const end = next < 0 ? text.length : next;
      const chunk = decodeEntities(text.slice(index, end));
      if (current !== undefined) current.text += chunk;
      else if (chunk.trim() !== "") throw new XmlSyntaxError("Text outside the root element");
      index = end;
    } else if (text.startsWith("<?", index)) {
      index = skipPast(text, index + 2, "?>");
    } else if (text.startsWith("<!--", index)) {
      index = skipPast(text, index + 4, "-->");
    } else if (text.startsWith("<![CDATA[", index)) {
      const end = skipPast(text, index + 9, "]]>");
      if (current === undefined) throw new XmlSyntaxError("CDATA outside the root element");
      current.text += text.slice(index + 9, end - 3);
      index = end;
    } else if (text.startsWith("<!", index)) {
      throw new XmlSyntaxError("Document type declarations are not supported");
    } else if (text.startsWith("</", index)) {
      const end = skipPast(text, index + 2, ">");
      const closed = open.pop();
      if (closed === undefined || closed.qualified !== text.slice(index + 2, end - 1).trim()) {
        throw new XmlSyntaxError("Mismatched closing tag");
      }
      index = end;
    } else {
      const end = tagEnd(text, index + 1);
      const body = text.slice(index + 1, end);
      const qualified = TAG_NAME.exec(body)?.[0];
      if (qualified === undefined) throw new XmlSyntaxError("Missing tag name");
      const element: XmlElement = { name: qualified.slice(qualified.indexOf(":") + 1), children: [], text: "" };
      if (current !== undefined) current.children.push(element);
      else if (root === undefined) root = element;
      else throw new XmlSyntaxError("More than one root element");
      if (!body.endsWith("/")) open.push({ qualified, element });
      index = end + 1;
    }
  }
  if (root === undefined || open.length > 0) throw new XmlSyntaxError("Incomplete document");
  return root;
}

export function childElements(parent: XmlElement, name: string): XmlElement[] {
  return parent.children.filter((child) => child.name === name);
}

export function childElement(parent: XmlElement, name: string): XmlElement | undefined {
  return parent.children.find((child) => child.name === name);
}
