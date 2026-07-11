import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { generateUniqueSlug } from '../lib/slug';

const router = Router();

const SPL_INCLUDE = {
  page: {
    select: { id: true, title: true, slug: true, updatedAt: true },
  },
};

// GET /api/spl — list all SPL commands
router.get('/', async (req, res) => {
  const { group, q, favorites } = req.query;

  const where: Record<string, unknown> = {};

  if (group) where.group = String(group);
  if (favorites === 'true') where.isFavorite = true;
  if (q) {
    where.OR = [
      { command: { contains: String(q) } },
      { description: { contains: String(q) } },
    ];
  }

  const commands = await prisma.splCommand.findMany({
    where,
    include: SPL_INCLUDE,
    orderBy: [{ group: 'asc' }, { command: 'asc' }],
  });

  res.json(commands);
});

// GET /api/spl/:id — get single SPL command
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const command = await prisma.splCommand.findUnique({
    where: { id },
    include: SPL_INCLUDE,
  });

  if (!command) return res.status(404).json({ error: 'SPL command not found' });
  res.json(command);
});

// POST /api/spl — create/upsert SplCommand for a page (upsert by pageId)
router.post('/', async (req, res) => {
  const { pageId, command, group, syntax, description, examples, pitfalls, isFavorite = false } = req.body;

  if (!pageId) return res.status(400).json({ error: 'pageId is required' });
  if (!command) return res.status(400).json({ error: 'command is required' });

  const result = await prisma.splCommand.upsert({
    where: { pageId: Number(pageId) },
    create: {
      pageId: Number(pageId),
      command: String(command),
      group: String(group || 'Other'),
      syntax: String(syntax || ''),
      description: String(description || ''),
      examples: String(examples || ''),
      pitfalls: pitfalls ? String(pitfalls) : null,
      isFavorite: Boolean(isFavorite),
    },
    update: {
      command: String(command),
      group: String(group || 'Other'),
      syntax: String(syntax || ''),
      description: String(description || ''),
      examples: String(examples || ''),
      pitfalls: pitfalls ? String(pitfalls) : null,
      isFavorite: Boolean(isFavorite),
    },
    include: SPL_INCLUDE,
  });

  res.status(201).json(result);
});

// PUT /api/spl/:id — update an existing SplCommand
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { command, group, syntax, description, examples, pitfalls, isFavorite } = req.body;

  const existing = await prisma.splCommand.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'SPL command not found' });

  const updated = await prisma.splCommand.update({
    where: { id },
    data: {
      ...(command !== undefined && { command: String(command) }),
      ...(group !== undefined && { group: String(group) }),
      ...(syntax !== undefined && { syntax: String(syntax) }),
      ...(description !== undefined && { description: String(description) }),
      ...(examples !== undefined && { examples: String(examples) }),
      ...(pitfalls !== undefined && { pitfalls: pitfalls ? String(pitfalls) : null }),
      ...(isFavorite !== undefined && { isFavorite: Boolean(isFavorite) }),
    },
    include: SPL_INCLUDE,
  });

  res.json(updated);
});

// DELETE /api/spl/:id — delete a SplCommand (page stays)
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.splCommand.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'SPL command not found' });

  await prisma.splCommand.delete({ where: { id } });
  res.status(204).send();
});

// POST /api/spl/seed — seed with 15 starter commands (idempotent)
router.post('/seed', async (req, res) => {
  const seedCommands = [
    {
      command: 'stats',
      group: 'Reporting',
      title: 'stats — Aggregate statistics',
      syntax: '... | stats <function> BY <field>',
      description: 'Calculates aggregate statistics over a dataset',
      examples: `\`\`\`spl
... | stats count
\`\`\`

Count events by field:
\`\`\`spl
... | stats count BY src_ip
\`\`\`

Multiple functions:
\`\`\`spl
... | stats count, avg(duration), max(bytes) BY host
\`\`\``,
      pitfalls: 'stats removes all fields not in the BY clause or functions',
    },
    {
      command: 'eval',
      group: 'Eval functions',
      title: 'eval — Create or overwrite a field',
      syntax: '... | eval <field>=<expression>',
      description: 'Creates or overwrites a field with a calculated value',
      examples: `String concatenation:
\`\`\`spl
... | eval full_name=first_name." ".last_name
\`\`\`

Conditional:
\`\`\`spl
... | eval status_label=if(status==200, "OK", "Error")
\`\`\`

Math:
\`\`\`spl
... | eval kb=bytes/1024
\`\`\``,
      pitfalls: 'eval does not filter events; use where for filtering',
    },
    {
      command: 'where',
      group: 'Filtering',
      title: 'where — Filter by boolean expression',
      syntax: '... | where <boolean-expression>',
      description: 'Filters events that match a boolean expression (SQL-like)',
      examples: `Filter by status:
\`\`\`spl
... | where status=200
\`\`\`

Filter by field length:
\`\`\`spl
... | where len(user)>0
\`\`\``,
      pitfalls: 'where is case-sensitive by default; use lower() for case-insensitive comparisons',
    },
    {
      command: 'rex',
      group: 'Search',
      title: 'rex — Extract fields via regex',
      syntax: '... | rex field=<field> "<regex>"',
      description: 'Extracts fields using named groups in a regex',
      examples: `Extract IP address:
\`\`\`spl
... | rex field=_raw "(?P<src_ip>\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})"
\`\`\`

Extract username:
\`\`\`spl
... | rex field=message "user=(?P<username>\\w+)"
\`\`\``,
      pitfalls: 'rex is applied to _raw by default if field is omitted',
    },
    {
      command: 'rename',
      group: 'Search',
      title: 'rename — Rename a field',
      syntax: '... | rename <old> AS <new>',
      description: 'Renames a field',
      examples: `Simple rename:
\`\`\`spl
... | rename src_ip AS source_ip
\`\`\`

Rename with wildcard:
\`\`\`spl
... | rename *_ip AS ip_*
\`\`\``,
      pitfalls: 'Original field name is removed after rename',
    },
    {
      command: 'table',
      group: 'Search',
      title: 'table — Display results in tabular format',
      syntax: '... | table <field1> <field2> ...',
      description: 'Returns results in tabular format, keeping only listed fields',
      examples: `Basic table:
\`\`\`spl
... | table _time, src_ip, dest_ip, action
\`\`\``,
      pitfalls: 'All other fields not listed are dropped from the results',
    },
    {
      command: 'dedup',
      group: 'Filtering',
      title: 'dedup — Remove duplicate events',
      syntax: '... | dedup <field>',
      description: 'Removes duplicate events based on field value(s)',
      examples: `Dedup by single field:
\`\`\`spl
... | dedup src_ip
\`\`\`

Dedup by multiple fields:
\`\`\`spl
... | dedup src_ip, dest_port
\`\`\`

With sortby:
\`\`\`spl
... | dedup src_ip sortby -_time
\`\`\``,
      pitfalls: 'Without sortby, which duplicate is kept is non-deterministic',
    },
    {
      command: 'sort',
      group: 'Search',
      title: 'sort — Sort results by field(s)',
      syntax: '... | sort <+/-> <field>',
      description: 'Sorts results by field(s)',
      examples: `Sort ascending:
\`\`\`spl
... | sort +_time
\`\`\`

Sort descending:
\`\`\`spl
... | sort -count
\`\`\`

Multi-field sort:
\`\`\`spl
... | sort -severity, +_time
\`\`\``,
      pitfalls: 'Default sort limit is 10,000 events',
    },
    {
      command: 'head',
      group: 'Search',
      title: 'head — Return first N events',
      syntax: '... | head <N>',
      description: 'Returns the first N events',
      examples: `First 10 events:
\`\`\`spl
... | head 10
\`\`\`

First event only:
\`\`\`spl
... | head 1
\`\`\``,
      pitfalls: 'Combine with sort for meaningful top-N results',
    },
    {
      command: 'top',
      group: 'Reporting',
      title: 'top — Most common field values',
      syntax: '... | top <field> [BY <groupby>]',
      description: 'Returns the most common values of a field',
      examples: `Top 10 source IPs:
\`\`\`spl
... | top 10 src_ip
\`\`\`

Top user agents by host:
\`\`\`spl
... | top useragent by host
\`\`\``,
      pitfalls: 'Automatically adds count and percent fields to results',
    },
    {
      command: 'eventstats',
      group: 'Reporting',
      title: 'eventstats — Add stats as new fields (keeps all events)',
      syntax: '... | eventstats <function> AS <field> BY <groupby>',
      description: "Like stats but adds result as a new field to each event (doesn't remove other fields)",
      examples: `Average duration by host added to each event:
\`\`\`spl
... | eventstats avg(duration) AS avg_duration BY host
\`\`\``,
      pitfalls: 'Keeps all original fields; use when you need both the stat and original event data',
    },
    {
      command: 'tstats',
      group: 'Reporting',
      title: 'tstats — Fast statistics over accelerated data models',
      syntax: '| tstats <function> FROM datamodel=<dm> WHERE <filter> BY <field> SPAN=<span>',
      description: 'Fast statistics over indexed data models (tsidx)',
      examples: `Count network traffic events:
\`\`\`spl
| tstats count FROM datamodel=Network_Traffic WHERE nodename=All_Traffic BY All_Traffic.src SPAN=1h
\`\`\``,
      pitfalls: 'Requires accelerated data models; much faster than stats for large datasets',
    },
    {
      command: 'lookup',
      group: 'Search',
      title: 'lookup — Enrich events with lookup table data',
      syntax: '... | lookup <lookup-name> <input-field> OUTPUT <output-field>',
      description: 'Enriches events using a lookup table or file',
      examples: `GeoIP lookup:
\`\`\`spl
... | lookup geoip clientip OUTPUT country, city
\`\`\`

User department lookup:
\`\`\`spl
... | lookup user_info user_id OUTPUT department, manager
\`\`\``,
      pitfalls: 'Case-sensitive by default; use OUTPUTNEW to avoid overwriting existing fields',
    },
    {
      command: 'makeresults',
      group: 'Search',
      title: 'makeresults — Generate synthetic events for testing',
      syntax: '| makeresults count=<N> annotate=<bool>',
      description: 'Generates synthetic events for testing',
      examples: `Generate 5 blank events:
\`\`\`spl
| makeresults count=5
\`\`\`

Generate events with eval:
\`\`\`spl
| makeresults count=3 | eval test_field="hello"
\`\`\``,
      pitfalls: 'Useful for testing SPL logic without real data',
    },
    {
      command: 'fields',
      group: 'Search',
      title: 'fields — Keep or remove specific fields',
      syntax: '... | fields [+/-] <field1> <field2>',
      description: 'Keeps (+) or removes (-) specified fields from results',
      examples: `Keep only listed fields:
\`\`\`spl
... | fields + src dest action
\`\`\`

Remove listed fields:
\`\`\`spl
... | fields - _raw _time
\`\`\``,
      pitfalls: '+ keeps only listed fields; - removes listed fields. Default is +',
    },
  ];

  const results: Array<{ command: string; status: string }> = [];

  for (const seed of seedCommands) {
    // Check if a SplCommand with this command name already exists
    const existing = await prisma.splCommand.findFirst({
      where: { command: seed.command },
    });

    if (existing) {
      results.push({ command: seed.command, status: 'skipped' });
      continue;
    }

    // Create the page first
    const slug = await generateUniqueSlug(seed.title);
    const page = await prisma.page.create({
      data: {
        title: seed.title,
        slug,
        contentMd: '',
        type: 'SPL_COMMAND',
        isPinned: false,
      },
    });

    // Create the SplCommand record
    await prisma.splCommand.create({
      data: {
        pageId: page.id,
        command: seed.command,
        group: seed.group,
        syntax: seed.syntax,
        description: seed.description,
        examples: seed.examples,
        pitfalls: seed.pitfalls,
        isFavorite: false,
      },
    });

    results.push({ command: seed.command, status: 'created' });
  }

  res.json({ seeded: results.filter((r) => r.status === 'created').length, results });
});

export default router;
