#pragma once

#include <Arduino.h>

/** Explicit operating states for one physical lane. */
enum class LaneState {
  Booting = 0,
  OnlineKiosk,
  OnlineWriter,
  Offline,
  ErrorRecovery,
};

const char* LaneStateName(LaneState state);

/**
 * Guards the kiosk/writer split. A unit can only ever handle one kind of
 * operation at a time; writer mode never processes attendance scans and kiosk
 * mode never claims write jobs.
 */
class LaneStateMachine {
 public:
  LaneStateMachine();

  LaneState state() const { return state_; }

  /** Validates a transition. Illegal transitions are refused and logged. */
  bool TransitionTo(LaneState next);

  bool CanHandleAttendance() const { return state_ == LaneState::OnlineKiosk; }
  bool CanHandleWriteJobs() const { return state_ == LaneState::OnlineWriter; }
  bool IsOffline() const { return state_ == LaneState::Offline; }

  /**
   * Applies the server-reported mode ("kiosk" or "writer"). Returns false for
   * unknown values; the unit then stays in its current safe state.
   */
  bool ApplyServerMode(const String& mode);

 private:
  LaneState state_;
};
