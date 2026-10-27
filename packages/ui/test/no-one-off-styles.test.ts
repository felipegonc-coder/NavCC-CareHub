import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import { findOneOffs, findStyleOneOff, noOneOffStyles } from '../lint/no-one-off-styles.js';

// RuleTester registers each case as a Vitest test.
Object.assign(RuleTester, { describe, it, itOnly: it.only });

const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run('carehub/no-one-off-styles', noOneOffStyles, {
  valid: [
    '<div className="rounded-sm rounded rounded-full bg-fill p-2 text-small font-semibold text-muted shadow-menu max-w-page" />',
    "cn('data-[state=open]:bg-fill aria-[invalid=true]:border-danger has-[:checked]:bg-primary [&>svg]:size-4 group-data-[state=open]:rotate-180');",
    "const menu = 'max-h-[var(--radix-select-content-available-height)] w-[var(--ch-sidebar-width)] transition-[width]';",
    "<div style={{ width: `${pct}%`, opacity: 0.5, zIndex: 2, padding: 0, color: 'rgb(var(--ch-fg))', background: 'transparent', '--gap': 3 }} />",
    "const skip = '#main-content'; const none = '0px'; const word = 'shadow';",
    "const scrim = 'bg-overlay/50 shadow-none max-w-full';",
    "import x from '#abc/def';",
    '<a href="https://example.com/#fff">Link</a>',
  ],
  invalid: [
    {
      code: '<div className="rounded-[4px] p-2" />',
      errors: [{ messageId: 'arbitrary' }],
    },
    {
      code: "cn('w-[85vw]', 'md:max-[900px]:p-2');",
      errors: [{ messageId: 'arbitrary' }, { messageId: 'arbitrary' }],
    },
    {
      code: "const a = 'bg-[#fff]/50';",
      errors: [{ messageId: 'arbitrary' }],
    },
    {
      code: '<svg><path fill="#191919" /></svg>',
      errors: [{ messageId: 'colour' }],
    },
    {
      code: "const scrim = 'bg-black/50 hover:text-gray-500';",
      errors: [{ messageId: 'notKit' }, { messageId: 'notKit' }],
    },
    {
      code: "const c = 'text-sm font-light rounded-lg shadow-md max-w-lg';",
      errors: [
        { messageId: 'notKit' },
        { messageId: 'notKit' },
        { messageId: 'notKit' },
        { messageId: 'notKit' },
        { messageId: 'notKit' },
      ],
    },
    {
      code: "const c = 'shadow p-2';",
      errors: [{ messageId: 'notKit' }],
    },
    {
      code: "matchMedia('(min-width: 768px)');",
      errors: [{ messageId: 'size' }],
    },
    {
      code: "<div\n  style={{\n    width: 240,\n    fontSize: '14px',\n    marginTop: -4,\n    color: 'white',\n  }}\n/>",
      errors: [
        { messageId: 'size' },
        { messageId: 'size' },
        { messageId: 'size' },
        { messageId: 'colour' },
      ],
    },
    {
      code: 'const t = `${base} rounded-[4px]`;',
      errors: [{ messageId: 'arbitrary' }],
    },
    {
      code: "const shade = 'rgb(0 0 0 / 0.5)';",
      errors: [{ messageId: 'colour' }],
    },
    {
      code: "const k = { 'text-[13px]': isSmall };",
      errors: [{ messageId: 'arbitrary' }],
    },
  ],
});

describe('findOneOffs', () => {
  it('names the one-off values in a class list', () => {
    expect(findOneOffs('rounded-[4px] p-2 bg-[#fff]').map((f) => f.value)).toEqual([
      'rounded-[4px]',
      'bg-[#fff]',
    ]);
    expect(findOneOffs('0 4px 16px #000').map((f) => f.kind)).toEqual(['colour', 'size', 'size']);
  });

  it('leaves state variants and kit variables alone', () => {
    expect(findOneOffs('data-[state=open]:bg-fill aria-[invalid=true]:p-2')).toEqual([]);
    expect(findOneOffs('rgb(var(--ch-fg) / 0.5)')).toEqual([]);
  });

  it('reads a digits-only hex as a colour only where CSS would', () => {
    expect(findOneOffs('#333')[0]?.kind).toBe('colour');
    expect(findOneOffs('color: #333')[0]?.kind).toBe('colour');
    expect(findOneOffs('Ticket #4521')).toEqual([]);
    expect(findOneOffs('Room #1234 is ready')).toEqual([]);
  });

  it("points Tailwind's defaults to the kit's names", () => {
    expect(findOneOffs('text-sm')[0]?.use).toContain('text-small');
    expect(findOneOffs('rounded-lg')[0]?.use).toContain('rounded-sm');
  });
});

describe('findStyleOneOff', () => {
  it('finds px numbers and colour names in style objects', () => {
    expect(findStyleOneOff('width', 240)?.kind).toBe('size');
    expect(findStyleOneOff('color', 'white')?.kind).toBe('colour');
  });

  it('allows unitless numbers, zero, keywords and custom properties', () => {
    expect(findStyleOneOff('opacity', 0.5)).toBeNull();
    expect(findStyleOneOff('width', 0)).toBeNull();
    expect(findStyleOneOff('color', 'currentColor')).toBeNull();
    expect(findStyleOneOff('--gap', 4)).toBeNull();
  });
});
