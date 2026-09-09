package com.hisder.worldBuilding.enrty;

public enum EntryType {
    EMPTY("⚠", "Прочее"),
    WORLD("🌐", "Миры"),
    CONTINENT("🏔", "Континенты"),
    STATE("👑", "Государства"),
    CITY("🏛", "Города"),
    REGION("🌍", "Регионы"),
    PEOPLE("👥", "Народы"),
    FACTION("🚩", "Фракции"),
    GOD("⭐", "Боги"),
    CREATURE("🐉", "Существа"),
    RELIC("☥", "Реликвии"),
    EVENT("⚔", "События");

    private final String icon;

    /**
     * Label for the synthetic grouping node ("category") this type's entries are
     * bucketed under in the hierarchy tree, e.g. {@code CITY -> "Города"}.
     */
    private final String categoryLabel;

    EntryType(String icon, String categoryLabel) {
        this.icon = icon;
        this.categoryLabel = categoryLabel;
    }

    public String getIcon() {
        return icon;
    }

    public String getCategoryLabel() {
        return categoryLabel;
    }
}