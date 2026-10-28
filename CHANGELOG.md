# Change Log

All notable changes to the "topocheck" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added

- Internal models for network devices, interfaces, protocols, connections and
  complete topologies.
- Consistency checks for unique identifiers, protocol compatibility and valid
  physical connections.
- Topology analyzer for missing interfaces, incomplete IP configurations,
  duplicate IPv4 addresses and unconnected devices.
- Unit and integration tests for the network model and topology analyzer.
- UML diagram, implementation plan and test plan for sub-goal H1.c.

### Existing prototype

- Initial VS Code extension activation and `.cfg`/`.ios` language registration.
- Basic real-time validation for Cisco-style configuration files.
