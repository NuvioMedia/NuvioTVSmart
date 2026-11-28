import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMuteRanges,
  containsProfanity,
  createProfanityMatcher,
  customWordToPattern,
  findMuteState,
  maskProfanity,
  mergeMuteRanges,
  muteRangesForCue,
  normalizeContentRating,
  normalizeWordList,
  spokenSubtitleText
} from "./profanityFilter.js";

const defaults = createProfanityMatcher({});
const everything = createProfanityMatcher({ categories: ["strong", "slurs", "mild", "religious"] });

test("matches common profanity and its variants", () => {
  for (const line of [
    "What the fuck?",
    "FUCKING hell",
    "motherfucker",
    "this is bullshit",
    "batshit crazy",
    "holy shit",
    "shitty day",
    "you asshole",
    "son of a bitch",
    "damn it",
    "goddamn",
    "he's a f***ing liar",
    "****"
  ]) {
    assert.equal(containsProfanity(line, defaults), true, line);
  }
});

test("does not flag innocent words that contain profane substrings", () => {
  for (const line of [
    "Class assassin passes the glass",
    "Hello from the shell",
    "Cocktail in the cockpit",
    "Scunthorpe United",
    "Grab the shiitake mushrooms",
    "The dam is holding",
    "Pass the assessment",
    "Hancock and Dickinson",
    "Therapist",
    "Harshit called"
  ]) {
    assert.equal(containsProfanity(line, defaults), false, line);
  }
});

test("religious exclamations are opt-in", () => {
  assert.equal(containsProfanity("Oh my God!", defaults), false);
  assert.equal(containsProfanity("Oh my God!", everything), true);
  assert.equal(
    maskProfanity("Oh my God, Jesus Christ!", everything, "stars", { showFirstLetter: true }),
    "Oh my G**, J**** C*****!"
  );
});

test("mask styles", () => {
  const line = "What the fuck is this shit?";
  assert.equal(
    maskProfanity(line, defaults),
    "What the **** is this ****?",
    "first letter hidden by default"
  );
  assert.equal(
    maskProfanity(line, defaults, "stars", { showFirstLetter: true }),
    "What the f*** is this s***?"
  );
  assert.equal(maskProfanity("Son of a bitch!", defaults, "stars"), "*** ** * *****!");
  assert.equal(
    maskProfanity(line, defaults, "censor"),
    "What the f*** is this s***?",
    "legacy alias"
  );
  assert.equal(maskProfanity(line, defaults, "stars"), "What the **** is this ****?");
  assert.equal(maskProfanity(line, defaults, "bleep"), "What the [bleep] is this [bleep]?");
  assert.equal(maskProfanity(line, defaults, "substitute"), "What the freak is this shoot?");
  assert.equal(maskProfanity(line, defaults, "remove"), "What the is this?");
  assert.equal(maskProfanity("Son of a bitch!", defaults, "substitute"), "Son of a gun!");
  assert.equal(maskProfanity("FUCKING", defaults, "substitute"), "FREAKING");
  assert.equal(maskProfanity("Damn.\nNo way.", defaults, "remove"), "No way.");
});

test("masking keeps lines, tags and clean text intact", () => {
  assert.equal(maskProfanity("<i>Fuck</i>\nOkay", defaults), "<i>****</i>\nOkay");
  assert.equal(maskProfanity("Nothing to see", defaults), "Nothing to see");
});

test("custom words support wildcards and the allow list wins", () => {
  const matcher = createProfanityMatcher({
    customWords: ["frak*", "smeg"],
    allowedWords: ["hell", "dick"]
  });
  assert.equal(maskProfanity("frakking smeg", matcher, "stars"), "******** ****");
  assert.equal(containsProfanity("go to hell, Dick", matcher), false);
  assert.equal(customWordToPattern("*"), "");
  assert.deepEqual(normalizeWordList("Frak, smeg\n smeg ,"), ["frak", "smeg"]);
});

test("spoken text drops tags, SDH and speaker labels for timing", () => {
  assert.equal(spokenSubtitleText("{\\an8}<i>JOHN: [sighs] Fuck.</i>"), "Fuck.");
});

test("word precision mutes around the word, line precision mutes the cue", () => {
  const cue = { start: 10, end: 14, text: "Well I said fuck that and left" };
  const [word] = muteRangesForCue(cue, defaults, { precision: "word", paddingMs: 0 });
  assert.ok(word.start > 11 && word.start < 12.2, `start ${word.start}`);
  assert.ok(word.end < 13, `end ${word.end}`);
  assert.deepEqual(muteRangesForCue(cue, defaults, { precision: "line", paddingMs: 250 }), [
    { start: 9.75, end: 14.25 }
  ]);
  assert.deepEqual(muteRangesForCue({ start: 1, end: 2, text: "clean" }, defaults), []);
});

test("ranges merge and the mute state is found by binary search", () => {
  assert.deepEqual(
    mergeMuteRanges([
      { start: 5, end: 6 },
      { start: 1, end: 2 },
      { start: 2.1, end: 3 }
    ]),
    [
      { start: 1, end: 3 },
      { start: 5, end: 6 }
    ]
  );
  const ranges = buildMuteRanges(
    [
      { start: 1, end: 2, text: "fuck" },
      { start: 5, end: 6, text: "shit" },
      { start: 8, end: 9, text: "fine" }
    ],
    defaults,
    { precision: "line", paddingMs: 0 }
  );
  assert.deepEqual(ranges, [
    { start: 1, end: 2 },
    { start: 5, end: 6 }
  ]);
  assert.deepEqual(findMuteState(ranges, 0.5), { muted: false, nextBoundary: 1 });
  assert.deepEqual(findMuteState(ranges, 1.5), { muted: true, nextBoundary: 2 });
  assert.deepEqual(findMuteState(ranges, 3), { muted: false, nextBoundary: 5 });
  assert.deepEqual(findMuteState(ranges, 7), { muted: false, nextBoundary: Infinity });
});

test("content ratings normalize loosely", () => {
  assert.deepEqual(
    ["TV-MA", "tv ma", "US: TVMA", "r", "nc17", "Unrated"].map(normalizeContentRating),
    ["TV-MA", "TV-MA", "TV-MA", "R", "NC-17", "NR"]
  );
});
