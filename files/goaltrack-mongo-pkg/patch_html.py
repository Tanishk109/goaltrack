#!/usr/bin/env python3
import re
from pathlib import Path

E = "div"
p = Path(__file__).parent / "frontend.html"
text = p.read_text()

# Remove broken <motion> tag if present
text = text.replace("<motion>", "")

# Employee dashboard stats grid (full block replace)
stats_old = """      <div class="stats-grid">
        <div class="stat-card blue">
          <div class="stat-icon blue"><i class="fa fa-bullseye"></i></div>
          <div class="stat-label">Active Goals</div>
          <motion>
        </div>"""

# Read actual content and replace whole stats section
stats_block_old = text[text.find("      <div class=\"stats-grid\">"):text.find("      <div class=\"two-col\">")]

stats_block_new = f"""      <div class="stats-grid">
        <{E} class="stat-card blue">
          <{E} class="stat-icon blue"><i class="fa fa-bullseye"></i></{E}>
          <{E} class="stat-value">—</{E}>
          <{E} class="stat-label">Active Goals</{E}>
          <{E} class="stat-change">—</{E}>
        </{E}>
        <{E} class="stat-card green">
          <{E} class="stat-icon green"><i class="fa fa-check-circle"></i></{E}>
          <{E} class="stat-value">—</{E}>
          <{E} class="stat-label">Avg. Achievement</{E}>
          <{E} class="stat-change">—</{E}>
        </{E}>
        <{E} class="stat-card orange">
          <{E} class="stat-icon orange"><i class="fa fa-clock"></i></{E}>
          <{E} class="stat-value">—</{E}>
          <{E} class="stat-label">Pending Check-ins</{E}>
          <{E} class="stat-change">—</{E}>
        </{E}>
        <{E} class="stat-card yellow">
          <{E} class="stat-icon yellow"><i class="fa fa-weight"></i></{E}>
          <{E} class="stat-value">—</{E}>
          <{E} class="stat-label">Weightage Used</{E}>
          <{E} class="stat-change">—</{E}>
        </{E}>
      </div>

"""

# Find stats grid in employee dashboard only
start = text.find('    <motion>'.replace("motion", "div") + '\n      <div class="stats-grid">')
start = text.find('    <div class="page" id="pg-employee-dashboard">')
if start == -1:
    raise SystemExit("employee dashboard not found")
start = text.find('      <motion>'.replace("motion", "div") + '\n        <div class="stat-card blue">', start)
start = text.find('      <div class="stats-grid">', start)
end = text.find('      <div class="two-col">', start)
if start == -1 or end == -1:
    raise SystemExit(f"stats grid bounds not found {start} {end}")

text = text[:start] + stats_block_new + text[end:]

# Notifications
old_notif = f"""        <{E} class="notif-btn" title="Notifications">
          <i class="fa fa-bell"></i>
          <span class="notif-dot"></span>
        </{E}>"""
new_notif = f"""        <{E} class="notif-wrap">
          <{E} class="notif-btn" id="notifBtn" title="Notifications" role="button" tabindex="0" aria-expanded="false" aria-controls="notifPanel">
            <i class="fa fa-bell"></i>
            <span class="notif-dot" id="notifDot"></span>
          </{E}>
          <{E} class="notif-panel" id="notifPanel" role="region" aria-label="Notifications">
            <{E} class="notif-panel-header">
              <span>Notifications</span>
              <button type="button" class="btn btn-outline btn-sm" id="notifMarkRead">Mark all read</button>
            </{E}>
            <{E} id="notifList">
              <{E} class="notif-empty">No notifications</{E}>
            </{E}>
          </{E}>
        </{E}>"""
if old_notif in text:
    text = text.replace(old_notif, new_notif)

# Timeline
m = re.search(
    r'<div class="checkin-timeline">.*?</motion>\s*</motion>\s*</motion>\s*<div class="card">\s*<div class="card-header">\s*<span class="card-title">📊 Q1 Achievement Summary</span>'.replace("motion", "div"),
    text,
    re.DOTALL,
)
if not m:
    m = re.search(
        r'<div class="checkin-timeline">[\s\S]*?</div>\s*</div>\s*</div>\s*<div class="card">\s*<div class="card-header">\s*<span class="card-title">📊 Q1 Achievement Summary</span>',
        text,
    )
if m:
    replacement = f'<{E} class="checkin-timeline" id="checkinTimeline"></{E}>\n          </{E}>\n        </{E}>\n      </{E}>\n\n      <{E} class="card">\n        <{E} class="card-header">\n          <span class="card-title" id="employeeAchievementSummaryTitle">📊 Achievement Summary</span>'
    text = text[:m.start()] + replacement + text[m.end():]
else:
    text = text.replace(
        '<span class="card-title">📊 Q1 Achievement Summary</span>',
        '<span class="card-title" id="employeeAchievementSummaryTitle">📊 Achievement Summary</span>',
    )

p.write_text(text)
print("patched ok")
