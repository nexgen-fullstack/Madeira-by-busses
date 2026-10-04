# Fonts for printable timetables

`Inter-Regular.subset.ttf` and `Inter-ExtraBold.subset.ttf` are [Inter](https://github.com/rsms/inter) 4
(SIL Open Font License 1.1, see `OFL.txt`) reduced to what the PDF timetables need: Latin with its
Central European letters, Cyrillic with Ukrainian ones, punctuation, arrows and the euro sign.
Digits are the tabular ones, so times line up in columns.

They were made with fontTools:

```bash
pyftfeatfreeze -f tnum Inter-Regular.ttf Inter-Regular-tnum.ttf
pyftsubset Inter-Regular-tnum.ttf --layout-features='' --drop-tables+=GSUB,GPOS,GDEF,DSIG \
  --no-hinting --name-IDs='*' --name-languages='*' --output-file=Inter-Regular.subset.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+0218-021B,U+02BC,U+02C6,U+02C7,U+02D8-02DD,\
U+0300-0304,U+0306-0308,U+030A-030C,U+0326-0328,U+0400-045F,U+0490-0491,U+2002-2015,U+2018-201E,\
U+2020-2022,U+2026,U+2030,U+2039-203A,U+2044,U+20AC,U+2116,U+2122,U+2190-2193,U+2212,U+2215,U+25CF,U+2713"
```
