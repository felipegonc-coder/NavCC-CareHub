# meetings/speech (web)

Speech-to-text for meeting notes, in the browser. The sound never leaves the computer (MT-06):
it's transcribed here and only the text goes to Care Hub. The speech model downloads once, from
Care Hub itself.

## How the sound flows

1. `capture.ts` opens the microphone with `openMicrophone()`. It makes the audio context and asks
   for the microphone before awaiting anything, so call it from the click that confirms consent.
   The AudioWorklet in `capture-worklet.js` mixes the sound to mono and posts it in blocks.
2. `audio.ts` resamples it to 16 kHz (`Resampler`: a Blackman-windowed sinc that filters below
   7.2 kHz first, so nothing folds back).
3. `pieces.ts` cuts it into pieces of up to 30 s (`Cutter`). After 20 s it cuts at the next pause
   (300 ms of quiet); at 30 s it cuts at the quietest 20 ms of the last 3 s. Quiet means within
   8 dB of the background, the 10th percentile of the last 30 s. A piece with less than 200 ms of
   loud sound isn't worth transcribing.
4. Pieces wait in IndexedDB (`idb.ts`, database `carehub-speech`) as 16-bit samples, with their
   sound stored apart, until their text is saved. Then they're deleted (MT-08, MT-09).

`types.ts` has the engine's interface (`SpeechEngine`, `SpeechState`, `SpeechLine`,
`Unfinished`) and the parts it's built from. `limits.ts` has the 3-hour limit and the warning
5 minutes before it (MT-14), and `finishingText()` ("Finishing the transcript… about 3 minutes
left.").

## Tests

`audio.test.ts`, `pieces.test.ts` and `limits.test.ts`. jsdom has neither IndexedDB nor Web
Audio, so `idb.ts` and `capture.ts` aren't unit tested.
