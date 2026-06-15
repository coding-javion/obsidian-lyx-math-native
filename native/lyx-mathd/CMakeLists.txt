cmake_minimum_required(VERSION 3.16)

project(lyx_mathd LANGUAGES CXX)

option(LYX_MATHD_USE_LYX_MATHED "Link LyX's native mathed library into lyx-mathd" OFF)
set(LYX_SOURCE_DIR "" CACHE PATH "Path to the LyX source tree")
set(LYX_BUILD_DIR "" CACHE PATH "Path to the configured LyX CMake build tree")

add_executable(lyx-mathd
  src/main.cpp
)

target_compile_features(lyx-mathd PRIVATE cxx_std_20)

if(MSVC)
  target_compile_options(lyx-mathd PRIVATE /W4)
else()
  target_compile_options(lyx-mathd PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(LYX_MATHD_USE_LYX_MATHED)
  if(NOT LYX_SOURCE_DIR)
    message(FATAL_ERROR "LYX_SOURCE_DIR is required when LYX_MATHD_USE_LYX_MATHED=ON")
  endif()
  if(NOT LYX_BUILD_DIR)
    message(FATAL_ERROR "LYX_BUILD_DIR is required when LYX_MATHD_USE_LYX_MATHED=ON")
  endif()

  find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets Concurrent Svg SvgWidgets)
  find_package(ZLIB REQUIRED)
  find_package(Iconv REQUIRED)

  set(LYX_CORE_OBJECT_DIR "${LYX_BUILD_DIR}/src/CMakeFiles/lyxcore_for_mathd.dir")
  if(NOT EXISTS "${LYX_CORE_OBJECT_DIR}")
    set(LYX_CORE_OBJECT_DIR "${LYX_BUILD_DIR}/src/CMakeFiles/LyX.dir")
  endif()
  file(GLOB LYX_CORE_OBJECTS "${LYX_CORE_OBJECT_DIR}/*.cpp.o")
  list(FILTER LYX_CORE_OBJECTS EXCLUDE REGEX "/(main|HunspellChecker)\\.cpp\\.o$")
  if(NOT LYX_CORE_OBJECTS)
    message(FATAL_ERROR "No LyX core object files found. Build the LyX target in LYX_BUILD_DIR first.")
  endif()

  target_compile_definitions(lyx-mathd PRIVATE LYX_MATHD_USE_LYX_MATHED=1)
  target_compile_definitions(lyx-mathd PRIVATE LYX_MATHD_USE_QT_FRONTEND=1)
  target_compile_definitions(lyx-mathd PRIVATE
    LYX_MATHD_SYSTEM_SUPPORT_DIR="${LYX_SOURCE_DIR}/lib")
  target_sources(lyx-mathd PRIVATE
    src/lyx_stubs.cpp
    ${LYX_CORE_OBJECTS})
  target_include_directories(lyx-mathd PRIVATE
    "${LYX_BUILD_DIR}"
    "${LYX_SOURCE_DIR}/src"
    "${LYX_SOURCE_DIR}/src/frontends"
    "${LYX_SOURCE_DIR}/src/frontends/qt"
    "${LYX_SOURCE_DIR}/src/mathed"
    "${LYX_SOURCE_DIR}/3rdparty/nod")
  target_link_libraries(lyx-mathd PRIVATE
    "${LYX_BUILD_DIR}/lib/libmathed.a"
    "${LYX_BUILD_DIR}/lib/libinsets.a"
    "${LYX_BUILD_DIR}/lib/libfrontend_qt.a"
    "${LYX_BUILD_DIR}/lib/libfrontends.a"
    "${LYX_BUILD_DIR}/lib/libgraphics.a"
    "${LYX_BUILD_DIR}/lib/libsupport.a"
    "${LYX_BUILD_DIR}/lib/libmytheslibstatic.a"
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::Concurrent
    Qt6::Svg
    Qt6::SvgWidgets
    ZLIB::ZLIB
    Iconv::Iconv
    "-framework AppKit")
endif()
