/**
 * Adjustments — what a person corrected after the generator decided.
 *
 * The engine has always taken these; nothing in the interface ever sent one, so
 * "I know this rig comes in a week early and the schedule does not" had no way
 * of being said. They are stored per production rather than posted with each
 * generation, because the product is the weekly reforecast and a judgement made
 * in prep should still hold in week six.
 *
 * Only redistributions can be made here. An amendment changes how much money
 * there is, which belongs in a versioned budget rather than in a schedule, and
 * the generator reports rather than applies them.
 */

import { Router } from 'express';
import { prisma } from '../db.js';
import { requireRole } from '../auth/middleware.js';

export const overridesRouter = Router({ mergeParams: true });

// The fields the generator actually consults. Offering any others would be
// inventing a control that silently does nothing.
export const FIELDS = {
  phase_window: {
    label: 'Move it to a different phase',
    help: 'Use this for equipment. Most rentals are budgeted as an allowance over '
      + 'a stated hire, which the schedule places against the shoot. Moving one to '
      + 'prep is how a crane wanted a week early for rigging lands a week early.',
    type: 'choice',
    choices: ['prep', 'shoot', 'wrap', 'post'],
    scopes: ['department', 'account'],
  },
  prep_lead_weeks: {
    label: 'Start prep earlier',
    help: 'Pushes prep spend further ahead of the shoot. This only moves money '
      + 'the budget already treats as prep — for a rental billed as an allowance, '
      + 'move it to prep first and then set this if it needs to be earlier still.',
    type: 'number',
    unit: 'weeks',
    scopes: ['department', 'account'],
  },
  cash_class: {
    label: 'Settles on different terms',
    help: 'Which payment lag this money follows. Prepaid leaves before the work, '
      + 'labour follows payroll, vendor follows invoice terms.',
    type: 'choice',
    choices: ['prepaid', 'labour', 'vendor'],
    scopes: ['department', 'account'],
  },
};

const SCOPES = ['line', 'account', 'department', 'production', 'company'];

function publicOverride(o) {
  return {
    id: o.id,
    field: o.field,
    value: o.value,
    scope: o.scope,
    key: o.key,
    kind: o.kind,
    origin: o.origin,
    reason: o.reason,
    author: o.authorName,
    createdAt: o.createdAt,
  };
}

/** The shape the extractor's OverrideSet.load expects. */
export async function overridePayloadFor(productionId) {
  const rows = await prisma.productionOverride.findMany({
    where: { productionId },
    orderBy: { createdAt: 'asc' },
  });
  if (!rows.length) return null;
  return {
    overrides: rows.map((o) => ({
      field: o.field,
      value: o.value,
      scope: o.scope,
      key: o.key,
      kind: o.kind,
      origin: o.origin,
      reason: o.reason,
      author: o.authorName,
      created: o.createdAt.toISOString().slice(0, 10),
    })),
  };
}

/** What can be adjusted, and what can be adjusted about it. */
overridesRouter.get('/fields', (_req, res) => {
  res.json({ fields: FIELDS });
});

overridesRouter.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.productionOverride.findMany({
      where: { productionId: req.production.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map(publicOverride));
  } catch (error) {
    next(error);
  }
});

overridesRouter.post('/', requireRole('editor'), async (req, res, next) => {
  try {
    const field = String(req.body?.field || '');
    const scope = String(req.body?.scope || '');
    const key = String(req.body?.key || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const origin = req.body?.origin === 'correction' ? 'correction' : 'judgement';
    let value = req.body?.value;

    const spec = FIELDS[field];
    if (!spec) {
      return res.status(400).json({
        error: `Unknown adjustment. This budget understands: ${Object.keys(FIELDS).join(', ')}.`,
      });
    }
    if (!SCOPES.includes(scope) || !spec.scopes.includes(scope)) {
      return res.status(400).json({
        error: `${spec.label} applies to ${spec.scopes.join(' or ')}, not ${scope || 'nothing'}.`,
      });
    }
    if (!key) return res.status(400).json({ error: 'Choose what this applies to.' });
    // A reason is the point. An adjustment nobody can explain in six weeks is
    // indistinguishable from a mistake.
    if (reason.length < 3) {
      return res.status(400).json({ error: 'Say why — this is read months later.' });
    }
    if (spec.type === 'number') {
      value = Number(value);
      if (!Number.isFinite(value) || value < 0 || value > 52) {
        return res.status(400).json({ error: 'Give a number of weeks between 0 and 52.' });
      }
    } else if (!spec.choices.includes(String(value))) {
      return res.status(400).json({
        error: `${spec.label} must be one of: ${spec.choices.join(', ')}.`,
      });
    }

    const saved = await prisma.productionOverride.upsert({
      where: {
        productionId_field_scope_key: {
          productionId: req.production.id, field, scope, key,
        },
      },
      update: { value, reason, origin, authorId: req.user.id, authorName: req.user.name || req.user.email },
      create: {
        productionId: req.production.id,
        field,
        value,
        scope,
        key,
        // Nothing here can change a total; that is the whole trust argument.
        kind: 'redistribute',
        origin,
        reason,
        authorId: req.user.id,
        authorName: req.user.name || req.user.email,
      },
    });
    return res.status(201).json(publicOverride(saved));
  } catch (error) {
    return next(error);
  }
});

overridesRouter.delete('/:overrideId', requireRole('editor'), async (req, res, next) => {
  try {
    const row = await prisma.productionOverride.findUnique({
      where: { id: req.params.overrideId },
    });
    if (!row || row.productionId !== req.production.id) {
      return res.status(404).json({ error: 'Adjustment not found.' });
    }
    await prisma.productionOverride.delete({ where: { id: row.id } });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});
