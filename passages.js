/* ============================================================
   passages.js
   ------------------------------------------------------------
   The text passages students type during a test.
   Each passage has: id, title, category ("SSC" or "Stenographer"),
   and two versions of text — "short" (for a 5 minute test) and
   "long" (for a 10 minute test).

   You can add more passages later by copying one block below
   and giving it a new unique id.
   ============================================================ */

const PASSAGE_BANK = [
  {
    id: "p1",
    title: "The Role of the Civil Services",
    category: "SSC",
    short:
      "The civil services form the steel frame of Indian administration. Officers selected through rigorous examinations are entrusted with the task of implementing policy at every level of government. From maintaining law and order to running welfare schemes, their work touches the daily life of every citizen. A good civil servant balances rules with fairness, and speed with accuracy, much like a skilled typist balances pace with precision.",
    long:
      "The civil services form the steel frame of Indian administration. Officers selected through rigorous examinations are entrusted with the task of implementing policy at every level of government. From maintaining law and order to running welfare schemes, their work touches the daily life of every citizen. A good civil servant balances rules with fairness, and speed with accuracy, much like a skilled typist balances pace with precision. Preparation for these examinations demands discipline across several fronts, including general awareness, quantitative aptitude, reasoning, and language skills. Among the practical skills tested for many posts is typing speed, since a large part of administrative work still depends on accurately drafting notes, letters, and reports within limited time. Students who practice typing regularly develop not only faster fingers but also sharper focus, because every keystroke has to be placed correctly the first time. Over weeks of consistent practice, words that once required conscious thought begin to flow automatically, freeing the mind to concentrate on meaning rather than mechanics. This is precisely the habit that examiners look for when they set a timed typing test, since real office work rarely offers the luxury of a second attempt."
  },
  {
    id: "p2",
    title: "Stenography as a Career",
    category: "Stenographer",
    short:
      "A stenographer must listen, understand, and record speech almost instantly. This demands complete concentration, a calm hand, and a trained ear for pace and pause. Government departments, courts, and legislative bodies rely on stenographers to produce a faithful written record of proceedings. The skill combines shorthand for dictation with a strong typing speed for transcription, and both must be sharpened together through steady daily practice.",
    long:
      "A stenographer must listen, understand, and record speech almost instantly. This demands complete concentration, a calm hand, and a trained ear for pace and pause. Government departments, courts, and legislative bodies rely on stenographers to produce a faithful written record of proceedings. The skill combines shorthand for dictation with a strong typing speed for transcription, and both must be sharpened together through steady daily practice. Selection examinations for stenographer posts typically test dictation at a fixed speed for a short duration, followed by a transcription period on a computer or typewriter, where accuracy is judged strictly against the original text. Even a small number of errors can bring down the final score considerably, so candidates are trained to prioritise correctness over raw speed in the early stages of practice. As comfort grows, speed increases naturally without a matching rise in mistakes. Many successful candidates describe their preparation as a slow climb rather than a sudden leap, built on short, focused sessions repeated daily rather than long, irregular ones. This is why typing practice platforms encourage frequent five and ten minute sessions, since they mirror the exact structure of the real examination and build both stamina and calm under a visible countdown clock."
  },
  {
    id: "p3",
    title: "General Awareness for Competitive Exams",
    category: "SSC",
    short:
      "General awareness sections in competitive examinations cover history, geography, polity, economics, and current affairs. Aspirants are advised to read newspapers daily, note down important events, and revise them at regular intervals. A strong foundation in static facts, combined with awareness of recent developments, helps candidates answer confidently even when questions are framed in an unfamiliar or indirect manner.",
    long:
      "General awareness sections in competitive examinations cover history, geography, polity, economics, and current affairs. Aspirants are advised to read newspapers daily, note down important events, and revise them at regular intervals. A strong foundation in static facts, combined with awareness of recent developments, helps candidates answer confidently even when questions are framed in an unfamiliar or indirect manner. Many successful candidates maintain a dedicated notebook where they summarise important schemes, committees, and appointments in their own words, since writing by hand or typing a summary tends to improve retention far more than passive reading alone. Typing these notes also doubles as speed practice, turning revision time into an opportunity to build the very skill that stenographer and data entry examinations demand separately. Over months of preparation, this dual habit of reading widely and typing regularly tends to produce candidates who are equally comfortable with the objective paper and the skill test, rather than treating the two as unrelated hurdles. Consistency, more than intensity on any single day, is what ultimately decides the outcome for most serious aspirants."
  },
  {
    id: "p4",
    title: "Building Typing Speed the Right Way",
    category: "Stenographer",
    short:
      "Typing speed is measured in words per minute, where every five keystrokes, including spaces, are counted as one word. Beginners often chase speed before accuracy and end up correcting mistakes that slow them down further. The better approach is to type slowly but correctly at first, gradually increasing pace only once the fingers find the correct keys without needing to look at the keyboard.",
    long:
      "Typing speed is measured in words per minute, where every five keystrokes, including spaces, are counted as one word. Beginners often chase speed before accuracy and end up correcting mistakes that slow them down further. The better approach is to type slowly but correctly at first, gradually increasing pace only once the fingers find the correct keys without needing to look at the keyboard. Touch typing, where each finger is assigned to a fixed set of keys, is considered the most reliable method for building both speed and accuracy together. Practising with the same posture, the same distance from the screen, and the same hand position every day helps the muscles form a consistent memory of the keyboard layout. Short, timed drills of five minutes are useful for warming up, while longer ten minute passages test whether that early speed can be sustained without a drop in accuracy toward the end. Tracking scores over time, rather than judging a single session in isolation, gives a truer picture of progress and helps identify whether errors are clustering around particular letters, punctuation marks, or moments of fatigue late in the passage."
  },
  {
    id: "p5",
    title: "Time Management in Examinations",
    category: "SSC",
    short:
      "Time management separates candidates who merely know the material from those who convert that knowledge into a good score. Practising under timed conditions, similar to the actual examination, trains the mind to allocate seconds wisely instead of dwelling too long on a single difficult question. Regular mock tests build this instinct far more effectively than untimed study alone.",
    long:
      "Time management separates candidates who merely know the material from those who convert that knowledge into a good score. Practising under timed conditions, similar to the actual examination, trains the mind to allocate seconds wisely instead of dwelling too long on a single difficult question. Regular mock tests build this instinct far more effectively than untimed study alone. The same principle applies directly to typing tests, where a visible countdown clock changes how a candidate performs compared to relaxed, untimed practice. Under time pressure, small habits such as glancing at the screen instead of the keyboard, or pausing to fix an early mistake, can cost several words per minute by the end of the test. Candidates who train specifically under a clock, rather than only practising typing casually, tend to perform closer to their true ability when it matters. This is why structured practice platforms present passages inside a timed test environment from the very first session, so that the discipline of working against a clock becomes familiar long before the actual examination day arrives."
  }
];

// Helper: get all passages for a given category ("SSC" or "Stenographer")
function getPassagesByCategory(category) {
  return PASSAGE_BANK.filter(p => p.category === category);
}

// Helper: get one passage by its id
function getPassageById(id) {
  return PASSAGE_BANK.find(p => p.id === id);
}
