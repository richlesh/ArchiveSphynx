cmake_minimum_required(VERSION 3.21)
project(ArchiveSphynx VERSION 2.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)
set(CMAKE_AUTOUIC_SEARCH_PATHS ${CMAKE_CURRENT_SOURCE_DIR}/ui)

find_package(Qt6 REQUIRED COMPONENTS Widgets Core Gui)
if(APPLE)
  list(APPEND CMAKE_PREFIX_PATH "/opt/homebrew/opt/libarchive" "/usr/local/opt/libarchive")
endif()
find_package(LibArchive REQUIRED)

set(SOURCES
  src/main.cpp
  src/MainWindow.cpp
  src/SettingsDialog.cpp
  src/LicenseDialog.cpp
  src/SplashScreen.cpp
  src/AboutDialog.cpp
  src/ArchiveManager.cpp
  src/Settings.cpp
  src/LicenseValidator.cpp
)

set(HEADERS
  src/MainWindow.h
  src/SettingsDialog.h
  src/LicenseDialog.h
  src/SplashScreen.h
  src/AboutDialog.h
  src/ArchiveManager.h
  src/Settings.h
  src/LicenseValidator.h
)

set(UI_FILES
  ui/MainWindow.ui
  ui/SettingsDialog.ui
  ui/LicenseDialog.ui
  ui/AboutDialog.ui
)

set(RESOURCES
  resources/resources.qrc
)

qt_add_executable(ArchiveSphynx
  ${SOURCES}
  ${HEADERS}
  ${UI_FILES}
  ${RESOURCES}
)

target_include_directories(ArchiveSphynx PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src ${LibArchive_INCLUDE_DIRS})
target_link_libraries(ArchiveSphynx PRIVATE Qt6::Widgets Qt6::Core Qt6::Gui ${LibArchive_LIBRARIES})

set_target_properties(ArchiveSphynx PROPERTIES
  MACOSX_BUNDLE TRUE
  WIN32_EXECUTABLE TRUE
)
