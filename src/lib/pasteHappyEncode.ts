const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';

function pushBits(value: number, bits: number, output: string[], state: { buffer: number; bitCount: number }) {
  for (let i = 0; i < bits; i += 1) {
    state.buffer = (state.buffer << 1) | ((value >> i) & 1);
    state.bitCount += 1;
    if (state.bitCount === 6) {
      output.push(alphabet.charAt(state.buffer));
      state.buffer = 0;
      state.bitCount = 0;
    }
  }
}

export function encodePostCopyToUriComponent(input: string): string {
  if (input == null || input === '') {
    return '';
  }

  const dictionary = new Map<string, number>();
  const pending = new Set<string>();
  let dictionarySize = 3;
  let numBits = 2;
  let enlargeIn = 2;

  const output: string[] = [];
  const state = { buffer: 0, bitCount: 0 };

  let w = '';

  for (let ii = 0; ii < input.length; ii += 1) {
    const c = input.charAt(ii);
    if (!dictionary.has(c)) {
      dictionary.set(c, dictionarySize++);
      pending.add(c);
    }

    const wc = w + c;
    if (dictionary.has(wc)) {
      w = wc;
    } else {
      if (pending.has(w)) {
        pending.delete(w);
        const charCode = w.charCodeAt(0);
        if (charCode < 256) {
          pushBits(0, numBits, output, state);
          pushBits(charCode, 8, output, state);
        } else {
          pushBits(1, numBits, output, state);
          pushBits(charCode, 16, output, state);
        }
      } else {
        const value = dictionary.get(w);
        if (value == null) {
          throw new Error('Unexpected missing dictionary entry.');
        }
        pushBits(value, numBits, output, state);
      }

      enlargeIn -= 1;
      if (enlargeIn === 0) {
        enlargeIn = 1 << numBits;
        numBits += 1;
      }

      dictionary.set(wc, dictionarySize++);
      w = c;
    }
  }

  if (w !== '') {
    if (pending.has(w)) {
      pending.delete(w);
      const charCode = w.charCodeAt(0);
      if (charCode < 256) {
        pushBits(0, numBits, output, state);
        pushBits(charCode, 8, output, state);
      } else {
        pushBits(1, numBits, output, state);
        pushBits(charCode, 16, output, state);
      }
    } else {
      const value = dictionary.get(w);
      if (value == null) {
        throw new Error('Unexpected missing dictionary entry.');
      }
      pushBits(value, numBits, output, state);
    }

    enlargeIn -= 1;
    if (enlargeIn === 0) {
      enlargeIn = 1 << numBits;
      numBits += 1;
    }
  }

  pushBits(2, numBits, output, state);

  while (true) {
    state.buffer <<= 1;
    state.bitCount += 1;
    if (state.bitCount === 6) {
      output.push(alphabet.charAt(state.buffer));
      break;
    }
  }

  return encodeURIComponent(output.join(''));
}
