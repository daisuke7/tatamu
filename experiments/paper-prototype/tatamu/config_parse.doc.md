# config_parse

Parses a simple `key = value` config file into a typed Config struct.

## Config

Application configuration.
Defaults: host = "localhost", port = 8080, verbose = false.

## parse

Parses `key=value` lines into a Config.
Blank lines and lines starting with `#` are ignored.
Returns an error if a line has no `=` or the port is not a number.
