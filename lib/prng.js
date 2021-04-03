((global) => {
  const { subtle } = window.crypto;

  const BLOCK_SIZE = 16;

  function genSeed() {
    return crypto.getRandomValues(new Uint8Array(BLOCK_SIZE));
  }

  function toHex(buf) {
    let hex = '';

    for (let i = 0, l = buf.length; i < l; i++) {
      const byte = buf[i].toString(16);;
      hex += byte.length === 2 ? byte : `0${byte}`;
    }

    return hex;
  }

  function fromHex(hex) {
    if (hex.length % 2 !== 0 || hex.match(/[^0-9a-f]/i)) {
      throw new Error('invalid hex string');
    }

    const buf = new Uint8Array(hex.length >> 1);
    for (let i = 0, l = hex.length; i < l; i += 2) {
      buf[i >> 1] = parseInt(hex.substr(i, 2), 16);
    }

    return buf;
  }

  async function getBytes(seed, len) {
    // NIST SP 800-90A with null key
    const nullKey = await subtle.importKey('raw', new Uint8Array(BLOCK_SIZE), 'AES-CTR', false, ['encrypt']);
    const algorithm = {
      name: 'AES-CTR',
      counter: Uint8Array.from(seed),
      length: 64,
    };

    return subtle.encrypt(algorithm, nullKey, new Int8Array(len));
  }

  global.PRNG = {
    BLOCK_SIZE,
    toHex,
    fromHex,
    genSeed,
    getBytes
  };
})(this);