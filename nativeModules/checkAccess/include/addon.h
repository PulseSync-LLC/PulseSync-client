#pragma once

#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <psapi.h>

#include <string>
#include <vector>

namespace discord_check {

extern const std::vector<std::string> discordNames;

bool IsProcessElevatedByPid(DWORD pid);

std::string GetProcessName(DWORD pid);

bool IsDiscordRunning();

bool IsAnyDiscordElevated();

}
