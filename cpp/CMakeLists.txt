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
  src/BouncingProgressBar.cpp
  src/SettingsDialog.cpp
  src/LicenseDialog.cpp
  src/SplashScreen.cpp
  src/AboutDialog.cpp
  src/ArchiveManager.cpp
  src/Settings.cpp
  src/LicenseValidator.cpp
  src/License.cpp
  src/Utilities.cpp
)

set(HEADERS
  src/MainWindow.h
  src/BouncingProgressBar.h
  src/SettingsDialog.h
  src/LicenseDialog.h
  src/SplashScreen.h
  src/AboutDialog.h
  src/ArchiveManager.h
  src/Settings.h
  src/LicenseValidator.h
  src/License.h
  src/Utilities.h
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

target_compile_definitions(ArchiveSphynx PRIVATE APP_VERSION="${PROJECT_VERSION}")
target_include_directories(ArchiveSphynx PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src ${LibArchive_INCLUDE_DIRS})
target_link_libraries(ArchiveSphynx PRIVATE Qt6::Widgets Qt6::Core Qt6::Gui ${LibArchive_LIBRARIES})

set_target_properties(ArchiveSphynx PROPERTIES
  MACOSX_BUNDLE TRUE
  MACOSX_BUNDLE_ICON_FILE app_icon.icns
  MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/Info.plist.in"
  WIN32_EXECUTABLE TRUE
)

set(APP_ICON "${CMAKE_CURRENT_SOURCE_DIR}/../app_icon.icns")
set(DOC_ICON_7ZIP "${CMAKE_CURRENT_SOURCE_DIR}/../doc_icon_7zip.icns")
set(DOC_ICON_ZIP "${CMAKE_CURRENT_SOURCE_DIR}/../doc_icon_zip.icns")
set(DOC_ICON_TAR "${CMAKE_CURRENT_SOURCE_DIR}/../doc_icon_tar.icns")
set_source_files_properties(${APP_ICON} ${DOC_ICON_7ZIP} ${DOC_ICON_ZIP} ${DOC_ICON_TAR}
  PROPERTIES MACOSX_PACKAGE_LOCATION "Resources")
target_sources(ArchiveSphynx PRIVATE ${APP_ICON} ${DOC_ICON_7ZIP} ${DOC_ICON_ZIP} ${DOC_ICON_TAR})

if(WIN32)
  target_sources(ArchiveSphynx PRIVATE resources/app_icon.rc)
endif()

if(UNIX AND NOT APPLE)
  install(TARGETS ArchiveSphynx RUNTIME DESTINATION bin)
  install(FILES resources/archivesphynx.desktop DESTINATION share/applications)
  install(FILES resources/archivesphynx-mime.xml DESTINATION share/mime/packages)
  install(FILES resources/icons/doc_icon_7zip.png DESTINATION share/icons/hicolor/256x256/mimetypes RENAME archivesphynx-doc-7zip.png)
  install(FILES resources/icons/doc_icon_zip.png DESTINATION share/icons/hicolor/256x256/mimetypes RENAME archivesphynx-doc-zip.png)
  install(FILES resources/icons/doc_icon_tar.png DESTINATION share/icons/hicolor/256x256/mimetypes RENAME archivesphynx-doc-tar.png)
  install(FILES resources/icons/app_icon.png DESTINATION share/icons/hicolor/256x256/apps RENAME archivesphynx.png)
endif()
