# H2c: Gemeinsame Speicheroperation

`TopologyStore.configureDevice(topologyId, deviceId, configuration)` verarbeitet
die vollständige Gerätekonfiguration in einem Vorgang:

1. Eine Kopie der Eingaben erfassen, bevor der Auftrag in die Schreibwarteschlange
   kommt. Spätere Änderungen am Formular oder am ursprünglichen Objekt beeinflussen
   den gestarteten Auftrag nicht.
2. Den aktuellen Stand lesen, ohne Reparaturen alter Dateien vorab zu speichern.
3. Geräteexistenz und sämtliche Angaben mit der gemeinsamen H1c-Validierung prüfen.
4. Ein vollständiges Ersatzgerät und einen neuen Topologiestand vorbereiten. IDs,
   Kabel, Layout und andere Geräte bleiben erhalten.
5. Den gesamten Stand in eine eigene temporäre Datei schreiben und damit die
   bisherige Datei ersetzen. Erst danach wird der Änderungszeitpunkt übernommen.
6. Genau ein `DeviceConfigUpdated`-Ereignis auslösen, noch innerhalb des
   serialisierten Schreibvorgangs.

Bei ungültigen Daten wird nichts geschrieben. Schlägt das Schreiben der temporären
Datei oder deren Ersetzung fehl, wird kein Erfolgsereignis ausgelöst. Der ursprüngliche
Fehler wird weitergegeben, und die temporäre Datei wird nach Möglichkeit entfernt.
Die alte Konfiguration wird nicht schrittweise überschrieben. Ein fehlgeschlagener
Auftrag blockiert spätere Speicherversuche nicht.

## Automatische Prüfung

Im Projektterminal:

```powershell
npm.cmd test -- --grep "H2c atomic save"
```

Erwartung: **6 passing**. Die Tests arbeiten ausschließlich mit temporären
Testtopologien und räumen ihre Testordner wieder auf.

| Fall | Prüfung |
| --- | --- |
| Gültige vollständige Änderung | Ein Schreibvorgang, eine Dateiersetzung, genau ein Ereignis nach der Ersetzung |
| Ungültige IP trotz anderer gültiger Änderungen | Keine Schreiboperation, alte Datei bytegenau erhalten, kein Ereignis |
| Alte Datei mit fehlenden Interfaces und ungültigem Entwurf | Auch automatische Reparaturen werden nicht vorab gespeichert |
| Absichtlich unterbrochenes Schreiben in die temporäre Datei | Ursprungsdatei unverändert, temporäre Datei entfernt, erneuter Versuch möglich |
| Absichtlich fehlgeschlagene Dateiersetzung | Ursprungsdatei unverändert, temporäre Datei entfernt, erneuter Versuch möglich |
| Zwei wartende Aufträge und nachträglich veränderte Eingabeobjekte | Getrennte Eingabeschnappschüsse, vollständige Dateien, letzter Auftrag gewinnt |

Die Fehler werden über einen eingesetzten Test-Dateischreiber ausgelöst. Dafür
müssen weder echte Topologien noch Dateirechte verändert werden.

## Manuelle Beispiele im F5-Fenster

Zuerst `npm.cmd run compile`, danach F5 und eine Topologie öffnen.

1. **Alles gemeinsam speichern:** Label `Router Wien`, Domain `schule.at` und
   Interface-IP `10.0.0.1` mit Maske `255.255.255.0` eintragen und speichern.
   Gerät erneut öffnen: Alle Werte müssen gemeinsam vorhanden sein.
2. **Fehler verhindert gesamte Änderung:** Label erneut ändern und gleichzeitig
   IP `999.1.1.1` eintragen. Speichern wird abgelehnt. Abbrechen und erneut öffnen:
   Auch das gültig geänderte Label darf nicht übernommen worden sein.
3. **Mehrere Interfaces:** „Alle Interfaces anzeigen“ einschalten. Auf Interface 1
   gültige Werte, auf Interface 2 eine IP ohne Maske eintragen. Es darf nichts
   übernommen werden, bis auch Interface 2 gültig oder wieder vollständig leer ist.
4. **Persistenz:** Gültige Werte speichern, F5-Fenster schließen, erneut mit F5
   starten und dieselbe Topologie öffnen. Die Werte und Kabel müssen erhalten sein.

Diese manuellen Beispiele prüfen den vollständigen UI-Ablauf. Die automatischen
Tests rufen zusätzlich den Store direkt auf, damit auch Fehler geprüft werden,
die bereits die Formularvalidierung abfangen würde.
