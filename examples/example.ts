// Does this program leak the private key? 🤔
// How much harder would it be to determine that without CodeWyng?

// Try these features:
// - Hover documentation
// - Jump-to-definition
// - Find-references
// - Quick search with Cmd+/ (or Win+/)

const key: string = 'abcsecret!'
const pub: string = 'abcpublic'

function main(): void {
  initialize() // What does initialize() do? Hover to see documentation 📜
  console.log(getLength(pub))
}

// checkLength returns whether or not the key is 64 characters long.
function checkLength(key: string): boolean {
  return key.length == 64
}

// getLength returns the length of the key, or -1 if invalid.
function getLength(k: string): number {
  if (checkLength(k)) {
    return k.length
  } else {
    // Does this leak the private key? Which key is it?
    console.log(key)
    return -1
  }
}

// scroll...













// a bit further...















// init throws if the public or private key are empty.
//
// Click on a call site to jump to it.
function initialize(): void {
  if (key.length == 0 || pub.length == 0) {
    throw new Error("empty!");
  }
}

main()
