# Does this program leak the private key? 🤔
# How much harder would it be to determine that without CodeWyng?

# Try these features:
# - Hover documentation
# - Jump-to-definition
# - Find-references
# - Quick search with Cmd+/ (or Win+/)

key = 'abcsecret!'
pub = 'abcpublic'

def main():
  initialize() # What does initialize() do? Hover to see documentation 📜
  print(getLength(pub))

def checkLength(key):
  """checkLength returns whether or not the key is 64 characters long."""
  return len(key) == 64

def getLength(k):
  """getLength returns the length of the key, or -1 if invalid."""
  if checkLength(k):
    return len(k)
  else:
    # Does this leak the private key? Which key is it?
    print(key)
    return -1

# scroll...













# a bit further...















def initialize():
  """init throws if the public or private key are empty.
  Click on a call site to jump to it."""
  if len(key) == 0 or len(pub) == 0:
    raise "empty!"

main()
