# SimpleDeck
### A lightweight single deck for DJing

https://abrwn.github.io/simpledeck/

A small project built with Preact and HTM. 

Uses Web Audio APIs to make a browser-based single DJ deck with only the essential features:
* Playback
* Cueing
* Pitch bend
* Seeking
* Tempo change
* Basic visualisation of the track's waveform

It's really built to meet a specific use case, which is to be able to plug your phone into a mixer in order to play some mp3s in an otherwise vinyl set, so you don't need any extra equipment.

Deliberately simple to avoid distraction and the need to fiddle (hopefully similar to DJing with records in that respect)...

Tested on iOS Safari as that's what I'm using it for. 

May work on other browsers. 

### Known issues
(not planning to fix right now as I'm really only using it on Safari iOS)

* I believe Chrome may not support reverse playback when seeking backwards.
* Tempo slider not orientated correctly in Safari for macOS.
