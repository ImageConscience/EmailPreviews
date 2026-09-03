import { prisma } from "@/lib/db";
import { parseRecord } from "@/lib/json";
import { renderTemplate } from "@/lib/template";
import { deriveValues } from "@/lib/derived";
import {
  COLLECTION_BLOCKS,
  applyFill,
  parseCollectionSpec,
  sortForOrder,
} from "@/lib/collection-spec";

/**
 * One row, rendered exactly as the preview renders it.
 *
 * The preview builds its HTML in the browser: collection blocks are filled from
 * a server action, derived values are computed, and the template is merged. A
 * push has to produce the same bytes, because the whole promise of the approval
 * is that what someone signed off on is what goes out -- and an approval is
 * fingerprinted against the row and the template, not against the HTML, so a
 * second render that disagreed would not be caught by anything.
 *
 * So the order here is not incidental and must match `PreviewWorkspace`: fills
 * first, derived values second. A tile filled from a collection has to have its
 * price before `deriveValues` can work a member price out of it.
 */

export interface RenderedRow {
  html: string;
  /** The values that produced it, for recording what was pushed. */
  values: Record<string, string>;
}

/**
 * Fill a block's slots from the catalogue, the way the workspace does.
 *
 * Reimplements `resolveCollectionAction`'s body rather than calling it: that
 * action carries its own access check and returns a shape built for the UI,
 * and a push has already established access by the time it gets here.
 */
async function fillFromCollections(
  companyId: string,
  values: Record<string, string>,
): Promise<Record<string, string>> {
  let next = values;

  for (const block of COLLECTION_BLOCKS) {
    const spec = parseCollectionSpec(next[block.field] ?? "", block.slots.length);
    if (!spec) continue;

    const collection = await prisma.catalogCollection.findUnique({
      where: { companyId_handle: { companyId, handle: spec.handle } },
      select: {
        products: {
          orderBy: { position: "asc" },
          select: {
            position: true,
            product: {
              select: { title: true, price: true, url: true, imageUrl: true, description: true },
            },
          },
        },
      },
    });
    if (!collection) continue;

    const items = collection.products.map((link, index) => ({
      title: link.product.title,
      price: link.product.price,
      url: link.product.url,
      imageUrl: link.product.imageUrl,
      description: link.product.description,
      position: link.position,
      // Same proxy the action uses: the feed gives no created date, but returns
      // products newest-first, so collection order stands in for it.
      createdOrder: collection.products.length - index,
    }));

    const ordered = sortForOrder(items, spec.order).slice(spec.offset, spec.offset + spec.limit);
    if (ordered.length) next = applyFill(next, block.slots, ordered);
  }

  return next;
}

/**
 * The row as it will be sent, given the template it is being sent in.
 *
 * Returns null when either the row or the template is not this company's, which
 * a caller should treat as "not found" rather than "empty".
 */
export async function renderRow(
  companyId: string,
  rowId: string,
  templateId: string,
): Promise<RenderedRow | null> {
  const [row, template] = await Promise.all([
    prisma.sheetRow.findFirst({
      where: { id: rowId, sheet: { companyId } },
      select: { data: true },
    }),
    prisma.template.findFirst({ where: { id: templateId, companyId }, select: { html: true } }),
  ]);
  if (!row || !template) return null;

  const filled = await fillFromCollections(companyId, parseRecord(row.data));
  const values = deriveValues(filled);

  return { html: renderTemplate(template.html, values).html, values };
}
