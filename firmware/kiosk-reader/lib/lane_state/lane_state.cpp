#include "lane_state.h"

namespace {

bool IsOnline(LaneState state) {
  return state == LaneState::OnlineKiosk || state == LaneState::OnlineWriter;
}

bool IsLegalTransition(LaneState from, LaneState to) {
  if (from == to) return false;
  switch (from) {
    case LaneState::Booting:
      return to == LaneState::OnlineKiosk || to == LaneState::OnlineWriter ||
             to == LaneState::Offline || to == LaneState::ErrorRecovery;
    case LaneState::OnlineKiosk:
      return to == LaneState::OnlineWriter || to == LaneState::Offline ||
             to == LaneState::ErrorRecovery || to == LaneState::Booting;
    case LaneState::OnlineWriter:
      return to == LaneState::OnlineKiosk || to == LaneState::Offline ||
             to == LaneState::ErrorRecovery || to == LaneState::Booting;
    case LaneState::Offline:
      return to == LaneState::Booting || to == LaneState::ErrorRecovery;
    case LaneState::ErrorRecovery:
      return to == LaneState::Booting || to == LaneState::Offline;
  }
  return false;
}

}  // namespace

const char* LaneStateName(LaneState state) {
  switch (state) {
    case LaneState::Booting:
      return "BOOTING";
    case LaneState::OnlineKiosk:
      return "ONLINE_KIOSK";
    case LaneState::OnlineWriter:
      return "ONLINE_WRITER";
    case LaneState::Offline:
      return "OFFLINE";
    case LaneState::ErrorRecovery:
      return "ERROR_RECOVERY";
  }
  return "UNKNOWN";
}

LaneStateMachine::LaneStateMachine() : state_(LaneState::Booting) {}

bool LaneStateMachine::TransitionTo(LaneState next) {
  if (!IsLegalTransition(state_, next)) {
    Serial.printf("[lane] refused transition %s -> %s\n", LaneStateName(state_),
                  LaneStateName(next));
    return false;
  }
  Serial.printf("[lane] %s -> %s\n", LaneStateName(state_), LaneStateName(next));
  state_ = next;
  return true;
}

bool LaneStateMachine::ApplyServerMode(const String& mode) {
  if (mode == "writer") {
    if (state_ == LaneState::Booting) return TransitionTo(LaneState::OnlineWriter);
    if (IsOnline(state_) && state_ != LaneState::OnlineWriter) {
      return TransitionTo(LaneState::OnlineWriter);
    }
    return state_ == LaneState::OnlineWriter;
  }
  if (mode == "kiosk") {
    if (state_ == LaneState::Booting) return TransitionTo(LaneState::OnlineKiosk);
    if (IsOnline(state_) && state_ != LaneState::OnlineKiosk) {
      return TransitionTo(LaneState::OnlineKiosk);
    }
    return state_ == LaneState::OnlineKiosk;
  }
  return false;
}
