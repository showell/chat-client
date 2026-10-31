//! The chat's browser client: hand-written JavaScript, no build step, served
//! verbatim at /chat/<name> and named by the pages by their bytes. This
//! table is the module `chat_client`, which a host's chat chrome imports,
//! so a build that serves the chat needs only this module, not each file.

/// One client script: its name under /chat/ and its bytes.
pub const Bundle = struct { name: []const u8, body: []const u8 };

pub const bundles = [_]Bundle{
    .{ .name = "colors.js", .body = @embedFile("colors.js") },
    .{ .name = "viewport.js", .body = @embedFile("viewport.js") },
    .{ .name = "chat_theme.js", .body = @embedFile("chat_theme.js") },
    .{ .name = "chrome_drawer.js", .body = @embedFile("chrome_drawer.js") },
    .{ .name = "chat_image_popup.js", .body = @embedFile("chat_image_popup.js") },
    .{ .name = "chat_code_popup.js", .body = @embedFile("chat_code_popup.js") },
    .{ .name = "chat_time_popup.js", .body = @embedFile("chat_time_popup.js") },
    .{ .name = "chat_save_popup.js", .body = @embedFile("chat_save_popup.js") },
    .{ .name = "message.js", .body = @embedFile("message.js") },
    .{ .name = "message_view.js", .body = @embedFile("message_view.js") },
    .{ .name = "middle_pane.js", .body = @embedFile("middle_pane.js") },
    .{ .name = "chat_search.js", .body = @embedFile("chat_search.js") },
    .{ .name = "chat_drag_to_pin.js", .body = @embedFile("chat_drag_to_pin.js") },
    .{ .name = "chat_add_topic.js", .body = @embedFile("chat_add_topic.js") },
    .{ .name = "chat_first_topic.js", .body = @embedFile("chat_first_topic.js") },
    .{ .name = "chat_left_sidebar.js", .body = @embedFile("chat_left_sidebar.js") },
    .{ .name = "chat_right_sidebar.js", .body = @embedFile("chat_right_sidebar.js") },
    .{ .name = "chat_emoji.js", .body = @embedFile("chat_emoji.js") },
    .{ .name = "chat_reactions.js", .body = @embedFile("chat_reactions.js") },
    .{ .name = "chat_compose.js", .body = @embedFile("chat_compose.js") },
    .{ .name = "chat_help.js", .body = @embedFile("chat_help.js") },
    .{ .name = "chat_responsive.js", .body = @embedFile("chat_responsive.js") },
    .{ .name = "chat.js", .body = @embedFile("chat.js") },
    .{ .name = "notify.js", .body = @embedFile("notify.js") },
    .{ .name = "docs.js", .body = @embedFile("docs.js") },
    .{ .name = "recent.js", .body = @embedFile("recent.js") },
    .{ .name = "styles.js", .body = @embedFile("styles.js") },
    .{ .name = "images.js", .body = @embedFile("images.js") },
    .{ .name = "code.js", .body = @embedFile("code.js") },
};

test "every bundle has bytes, and no name is listed twice" {
    const std = @import("std");
    for (bundles, 0..) |a, i| {
        try std.testing.expect(a.body.len > 0);
        for (bundles[i + 1 ..]) |b| try std.testing.expect(!std.mem.eql(u8, a.name, b.name));
    }
}
