const std = @import("std");

// `zig build test` checks the table; `node tools/test_chat_resize.mjs` tests
// the photo resize.
pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // **`chat_client`, THE CHAT'S BROWSER CLIENT**: js/bundles.zig, each
    // script's name and bytes. Nothing but `@embedFile`, so a host on any
    // target takes it as it is.
    _ = b.addModule("chat_client", .{
        .root_source_file = b.path("js/bundles.zig"),
        .target = target,
        .optimize = optimize,
    });

    const t = b.addTest(.{ .root_module = b.createModule(.{
        .root_source_file = b.path("js/bundles.zig"),
        .target = target,
        .optimize = optimize,
    }) });
    b.step("test", "Check the bundle table").dependOn(&b.addRunArtifact(t).step);
}
