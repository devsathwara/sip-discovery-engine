import { describe, expect, it } from 'vitest';
import { isHindiOrHinglish, isPrefilteredGeneric } from '../lib/classify/prefilter';
import { parseClassification, quoteIsVerbatim } from '../lib/classify/schema';
import { stratifiedSample } from '../lib/classify/sample';
import { hasContinuationSignal } from '../lib/classify/signals';
import { CLASSIFIER_SYSTEM } from '../lib/classify/taxonomy';

describe('continuation signals', () => {
  it('matches stop, pause, refund, and Hindi loss phrases', () => {
    expect(hasContinuationSignal('I paused my SIP')).toBe(true);
    expect(hasContinuationSignal('they skipped this sip today')).toBe(true);
    expect(hasContinuationSignal('Autopay band ho gaya hai')).toBe(true);
    expect(hasContinuationSignal('paisa nahi aya')).toBe(true);
    expect(hasContinuationSignal('return nahi badh raha')).toBe(true);
    expect(hasContinuationSignal('5 lakh ka nuksan')).toBe(true);
    expect(hasContinuationSignal('supar aap zbrdast')).toBe(false);
    expect(hasContinuationSignal('skip the intro of this video')).toBe(false);
    expect(hasContinuationSignal('Thank you for your kind words')).toBe(false);
  });
});

describe('sip prefilter', () => {
  it('flags generic praise, emoji-only, and short text without a SIP keyword', () => {
    for (const text of ['nice', 'good', 'best', 'super', 'excellent', 'helpful', 'very good app', 'super 👍', '😀😀', 'very good experience']) {
      expect(isPrefilteredGeneric(text), text).toBe(true);
    }
    expect(isPrefilteredGeneric('I stopped my SIP because the mandate failed')).toBe(false);
    expect(isPrefilteredGeneric('सिप बंद हो गया क्योंकि बैलेंस नहीं था')).toBe(false);
  });

  it('keeps the taxonomy prompt and adds the language line', () => {
    expect(CLASSIFIER_SYSTEM).toContain('Do NOT summarize or score sentiment');
    expect(CLASSIFIER_SYSTEM).toContain('never infer income, age, or app');
    expect(CLASSIFIER_SYSTEM).toContain('Items may be in Hindi, Hinglish, or other Indian languages');
    expect(CLASSIFIER_SYSTEM).toContain('Keep the verbatim quote in its original language.');
    expect(CLASSIFIER_SYSTEM).toContain('reallocated_goal_changed, sip_rigidity_wants_control, social_influence_told_to_stop');
    expect(CLASSIFIER_SYSTEM).toContain(
      "voluntary / involuntary = the text reflects THIS person's OWN SIP being stopped, paused, reduced, skipped, or failing, OR the direct aftermath of their own stop"
    );
    expect(CLASSIFIER_SYSTEM).toContain(
      'not_continuation = about SIPs but NOT the person\'s own stop: purely hypothetical ("what if returns fall"), impersonal/generic advice with no personal action, calculations, and which-fund or how-to-start questions.'
    );
    expect(CLASSIFIER_SYSTEM).toContain('irrelevant = not about SIP continuation at all.');
  });

  it('rejects a leaf that does not match its gate', () => {
    expect(
      parseClassification({
        primary_gate: 'involuntary',
        leaf: 'money_tight',
        segment: { app: 'unknown', tenure: 'unknown', income_stability: 'unknown', money_source: 'unknown', influencer: 'unknown' },
        expectation_mismatch: 'unknown',
        workaround: 'none',
        outcome: 'unknown',
        quote: 'mandate failed',
        confidence: 'low',
        reasoning: 'The leaf is on the wrong gate.'
      })
    ).toBeNull();
    expect(
      parseClassification({
        primary_gate: 'voluntary',
        leaf: 'reallocated_goal_changed',
        segment: { app: 'unknown', tenure: 'unknown', income_stability: 'unknown', money_source: 'unknown', influencer: 'unknown' },
        expectation_mismatch: 'unknown',
        workaround: 'none',
        outcome: 'stopped',
        quote: 'stopped SIP and moved',
        confidence: 'high',
        reasoning: 'The person moved an active SIP to another goal.'
      })?.leaf
    ).toBe('reallocated_goal_changed');
    expect(quoteIsVerbatim('I stopped my SIP', 'stopped my SIP')).toBe(true);
    expect(quoteIsVerbatim('I stopped my SIP', 'I paused it')).toBe(false);
  });

  it('samples in proportion to source size', () => {
    const rows = [
      ...Array.from({ length: 50 }, (_, index) => ({ id: `p${index}`, source: 'playstore', text: 'play' })),
      ...Array.from({ length: 30 }, (_, index) => ({ id: `y${index}`, source: 'youtube', text: 'you' })),
      ...Array.from({ length: 20 }, (_, index) => ({ id: `r${index}`, source: 'reddit', text: 'red' }))
    ];
    const sample = stratifiedSample(rows, 10, 7);
    const counts = sample.reduce<Record<string, number>>((sum, row) => {
      sum[row.source] = (sum[row.source] ?? 0) + 1;
      return sum;
    }, {});
    expect(sample).toHaveLength(10);
    expect(counts.playstore).toBe(5);
    expect(counts.youtube).toBe(3);
    expect(counts.reddit).toBe(2);
    expect(isHindiOrHinglish('सिप बंद')).toBe(true);
    expect(isHindiOrHinglish('paise nahi aaye')).toBe(true);
  });
});
