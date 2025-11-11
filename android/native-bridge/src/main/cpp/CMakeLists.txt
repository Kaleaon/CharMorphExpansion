cmake_minimum_required(VERSION 3.22.1)

project("native_bridge")

add_library(
        native_bridge
        SHARED
        assimp_bridge.cpp)

target_link_libraries(
        native_bridge
        android
        log)
