# remove-shell-block.awk
# Strips the "Nemus - Shell Integration" block from an RC
# file, preserving all surrounding user content (including comments placed
# directly after the block).
#
# Usage:  awk -f remove-shell-block.awk "$RC_FILE" > "$TMPFILE"

/^# Nemus - Shell Integration/ { skip=1; depth=0; saw_func=0; buf="" }
skip {
  # Inside a function body — track brace depth
  if (depth > 0) {
    n = gsub(/{/, "{")
    m = gsub(/}/, "}")
    depth += n - m
    next
  }
  # Blank or comment lines: before first function just skip;
  # after a function, buffer them (might be user content after block)
  if (/^[[:space:]]*$/ || /^#/) {
    if (saw_func) { buf = buf $0 "\n" }
    next
  }
  if (/\(\)[[:space:]]*{/) {
    # New function definition — discard buffered lines, count braces
    buf = ""
    n = gsub(/{/, "{"); m = gsub(/}/, "}")
    depth = n - m; saw_func = 1
    next
  }
  if (/\(\)/) {
    # Function def without opening brace on same line
    buf = ""
    saw_func = 1
    next
  }
  if (/\.nemus\/shell-integration\.sh/ && /source/) {
    # Current installs keep the functions in a generated file and leave only
    # this source line in the RC file.
    skip = 0
    saw_func = 0
    buf = ""
    next
  }
  # Non-function line: block is over — emit any buffered lines
  skip = 0
  if (buf != "") printf "%s", buf
  buf = ""
  print
  next
}
END { if (buf != "") printf "%s", buf }
{ print }
