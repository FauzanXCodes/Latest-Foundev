
"use strict";

/* =========================================================
   FOUNDEV — INSTITUTION PROJECT MARKETPLACE
   File: institute-users/assets/js/projects.js

   - Three-student price on every card
   - Multi-project selection
   - Partner pricing from 15 selected projects
   - Partner price displayed in project details
   - Separate bulk checkout dialog
   - Individual checkout from project details
   - Cashfree hosted checkout
   - Server-side payment verification

   Bulk API required:
   ../api/admin/create-project-bulk-order.php
   ../api/admin/verify-project-bulk-payment.php
========================================================= */

(() => {
    const API = {
    catalogue: "../api/admin/project-catalog.php?action=list",
    dashboard: "../api/admin/admin-dashboard.php",

    verifyStudents: "../api/admin/verify-students.php",

    createSingleOrder: "../api/admin/create-project-order.php",
    createBulkOrder: "../api/admin/create-project-bulk-order.php",

    verifySinglePayment: "../api/admin/verify-project-payment.php",
    verifyBulkPayment: "../api/admin/verify-project-bulk-payment.php"
};
    const MIN_PARTNER_PROJECTS = 15;
    const DEFAULT_TEAM_SIZE = 3;

    const $ = (selector, root = document) =>
        root.querySelector(selector);

    const $$ = (selector, root = document) =>
        Array.from(root.querySelectorAll(selector));

    const state = {
    projects: [],
    filtered: [],
    selectedIds: new Set(),

    selectedProject: null,

    teamSize: DEFAULT_TEAM_SIZE,

    checkoutMode: "single",

    paymentBusy: false,
    paymentOrderId: null,
    paymentMode: "single",

    loadController: null,

    cashfree: null,

    formOrigin: null,
    bulkDialog: null,

    profilesVerified: false,
    verifiedStudents: []
};

    const el = {
        institutionName: $("#institution-name"),
        institutionInitial: $("#institution-initial"),

        adminName: $("#admin-name"),
        adminEmail: $("#admin-email"),
        adminInitial: $("#admin-initial"),

        systemStatus: $("#system-status"),
        systemStatusText: $("#system-status-text"),

        dashboardDate: $("#dashboard-date"),
        currentYear: $("#current-year"),

        total: $("#projects-total"),

        search: $("#project-search"),
        category: $("#project-category-filter"),
        sort: $("#project-sort"),

        resultsCount: $("#projects-results-count"),
        clearFilters: $("#clear-project-filters"),

        loading: $("#projects-loading"),
        error: $("#projects-error"),
        errorMessage: $("#projects-error-message"),
        retry: $("#retry-projects-button"),

        empty: $("#projects-empty"),
        emptyTitle: $("#projects-empty-title"),
        emptyDescription: $("#projects-empty-description"),

        grid: $("#projects-catalogue-grid"),
        refresh: $("#refresh-projects-button"),

        detailsDialog: $("#project-details-dialog"),

        detailTitle: $("#project-dialog-title"),
        detailSubtitle: $("#project-dialog-subtitle"),
        detailDescription: $("#detail-project-description"),
        detailTechnologies: $("#detail-project-technologies"),
        detailFeatures: $("#detail-project-features"),

        checkoutForm: $("#project-checkout-form"),
        projectId: $("#selected-project-id"),
        checkoutProjectName: $("#checkout-project-name"),

        teamName: $("#checkout-team-name"),
        customerPhone: $("#checkout-customer-phone"),

        checkoutMessage: $("#project-checkout-message"),
        checkoutButton: $("#project-checkout-button"),

        selectedTierPrice: $("#selected-tier-price"),
        selectedTierDescription: $("#selected-tier-description"),
        pricingStatus: $("#pricing-status"),

        teamProfileSection: $("#team-profile-section"),
        teamProfileContainer: $("#team-profile-container"),
        confirmTeamProfiles: $("#confirm-team-profiles"),

        paymentDialog: $("#project-payment-dialog"),
        paymentTitle: $("#payment-dialog-title"),
        paymentDescription: $("#payment-dialog-description"),
        paymentResult: $("#project-payment-result"),
        paymentMessage: $("#payment-result-message"),
        paymentRetry: $("#payment-retry-button"),
        paymentDone: $("#payment-done-button")
    };

    /* =====================================================
       HELPERS
    ===================================================== */

    function first(...values) {
        return values.find(value =>
            value !== undefined &&
            value !== null &&
            value !== ""
        );
    }

    function setText(element, value, fallback = "") {
        if (!element) return;

        element.textContent =
            value === undefined || value === null || value === ""
                ? fallback
                : String(value);
    }

    function setHidden(element, hidden) {
        if (element) element.hidden = Boolean(hidden);
    }

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function toPrice(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        const number = Number(value);

        return Number.isFinite(number) && number >= 0
            ? number
            : null;
    }

    function formatPrice(value, currency = "INR") {
        const amount = toPrice(value);

        if (amount === null) return "Price unavailable";

        try {
            return new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: currency || "INR",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(amount);
        } catch {
            return `₹${amount.toLocaleString("en-IN")}`;
        }
    }

    function formatList(value) {
        if (Array.isArray(value)) {
            return value.map(item => {
                if (typeof item === "string" || typeof item === "number") {
                    return String(item).trim();
                }

                if (item && typeof item === "object") {
                    return String(first(
                        item.name,
                        item.title,
                        item.technology,
                        item.description,
                        ""
                    )).trim();
                }

                return "";
            }).filter(Boolean);
        }

        if (typeof value !== "string" || !value.trim()) {
            return [];
        }

        try {
            const parsed = JSON.parse(value);

            if (Array.isArray(parsed)) {
                return formatList(parsed);
            }
        } catch {
            // Continue with comma/newline separated values.
        }

        return value
            .split(/[,;\n\r]+/)
            .map(item => item.trim())
            .filter(Boolean);
    }

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            method: options.method || "GET",
            credentials: "same-origin",
            cache: "no-store",

            headers: {
                Accept: "application/json",

                ...(options.body
                    ? { "Content-Type": "application/json" }
                    : {})
            },

            signal: options.signal,
            body: options.body
        });

        const raw = await response.text();

        let data;

        try {
            data = raw ? JSON.parse(raw) : {};
        } catch {
            throw new Error(
                `Invalid JSON from ${url}. HTTP ${response.status}.`
            );
        }

        if (!response.ok || data.success === false) {
            throw new Error(
                data.message ||
                data.error ||
                `Request failed. HTTP ${response.status}.`
            );
        }

        return data;
    }

    function unwrap(response) {
        return response?.data ?? response;
    }

    function setConnectionStatus(message, status = "connecting") {
        setText(el.systemStatusText, message);

        if (el.systemStatus) {
            el.systemStatus.dataset.state = status;
        }
    }

    /* =====================================================
       PROJECT PRICING
    ===================================================== */

    function getRawTierPrice(raw, teamSize) {
        const nested = raw?.pricing?.tiers?.[String(teamSize)];

        if (nested && nested.price !== undefined) {
            return toPrice(nested.price);
        }

        const fields = {
            1: [
                raw.individual_price,
                raw.price_individual,
                raw.price_for_1,
                raw.price_1_member,
                raw.single_student_price
            ],

            2: [
                raw.pair_price,
                raw.price_pair,
                raw.price_for_2,
                raw.price_2_members,
                raw.two_student_price
            ],

            3: [
                raw.team_price,
                raw.price_team,
                raw.price_for_3,
                raw.price_3_members,
                raw.three_student_price,
                raw.university_price
            ]
        };

        return toPrice(first(...(fields[teamSize] || [])));
    }

    function getPartnerPrice(project) {
        const raw = project.raw || project;

        return toPrice(first(
            raw.partner_institution_price,
            raw.partner_price,
            raw.pricing?.partner_institution?.price,
            raw.pricing?.partner_price
        ));
    }

    function getTierPrice(project, teamSize = 3) {
        return getRawTierPrice(project.raw || project, teamSize);
    }

    function normalizeProject(raw) {
        const category = String(first(
            raw.domain,
            raw.category,
            raw.project_category,
            raw.project_type,
            "General"
        ));

        const technologies = formatList(first(
            raw.technologies,
            raw.tech_stack,
            raw.technology_stack,
            raw.technology
        ));

        const features = formatList(first(
            raw.features,
            raw.key_features,
            raw.highlights,
            raw.project_features
        ));

        const featuredValue = first(
            raw.is_featured,
            raw.featured,
            false
        );

        return {
            raw,

            id: String(first(
                raw.id,
                raw.project_id,
                raw.projectId
            )),

            title: String(first(
                raw.title,
                raw.name,
                raw.project_name,
                "Untitled project"
            )),

            description: String(first(
                raw.description,
                raw.short_description,
                raw.project_description,
                "Project description is not available."
            )),

            category,

            categorySlug: category
                .toLowerCase()
                .replace(/&/g, " ")
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, ""),

            technologies,
            features,

            currency: String(first(raw.currency, "INR")),

            individualPrice: getRawTierPrice(raw, 1),
            pairPrice: getRawTierPrice(raw, 2),
            teamPrice: getRawTierPrice(raw, 3),

            partnerPrice: toPrice(first(
                raw.partner_institution_price,
                raw.partner_price,
                raw.pricing?.partner_institution?.price,
                raw.pricing?.partner_price
            )),

            featured: [
                true,
                1,
                "1",
                "true",
                "yes"
            ].includes(
                typeof featuredValue === "string"
                    ? featuredValue.toLowerCase()
                    : featuredValue
            ),

            validityMonths: Number(raw.validity_months) || 6,

isPurchased: [
    true, 1, "1", "true", "yes"
].includes(
    typeof raw.is_purchased === "string"
        ? raw.is_purchased.toLowerCase()
        : raw.is_purchased
),

purchaseType: raw.purchase_type || null,

purchaseExpiresAt: raw.access_expires_at || null
        };
    }

    function extractProjects(response) {
        const data = unwrap(response);

        if (Array.isArray(data)) return data;
        if (Array.isArray(data.projects)) return data.projects;
        if (Array.isArray(data.catalogue)) return data.catalogue;
        if (Array.isArray(data.items)) return data.items;

        throw new Error(
            "The catalogue API did not return a projects array."
        );
    }

  function getSelectedProjects() {
    return state.projects.filter(project =>
        !project.isPurchased &&
        state.selectedIds.has(String(project.id))
    );
}

   function hasPartnerEligibility() {
    return getSelectedProjects().length >= MIN_PARTNER_PROJECTS;
}

    function getProjectPrice(project, teamSize = state.teamSize) {
        if (
            hasPartnerEligibility() &&
            state.selectedIds.has(String(project.id))
        ) {
            const partnerPrice = getPartnerPrice(project);

            if (partnerPrice !== null) {
                return {
                    amount: partnerPrice,
                    mode: "partner_institution"
                };
            }
        }

        return {
            amount: getTierPrice(project, teamSize),
            mode: "student_tier"
        };
    }

    function getSelectionTotal() {
        const selected = getSelectedProjects();

        if (!selected.length) return null;

        let total = 0;

        for (const project of selected) {
            const price = getProjectPrice(project);

            if (price.amount === null) return null;

            total += price.amount;
        }

        return total;
    }

    /* =====================================================
       ADMIN DETAILS
    ===================================================== */

    async function loadAdminDetails() {
        try {
            const response = await apiRequest(API.dashboard);
            const data = unwrap(response);

            const admin = data.administrator || data.admin || {};
            const institution = data.institution || data.institute || {};

            const adminName = first(
                admin.name,
                admin.full_name,
                admin.admin_name,
                data.admin_name
            );

            const adminEmail = first(
                admin.email,
                admin.email_address,
                data.admin_email
            );

            const institutionName = first(
                institution.name,
                institution.institution_name,
                institution.college_name,
                institution.institute_name,
                data.institution_name
            );

            setText(el.adminName, adminName, "Administrator");
            setText(el.adminEmail, adminEmail, "Account details unavailable");

            if (el.adminInitial) {
                el.adminInitial.textContent = getInitials(adminName, "A");
            }

            setText(el.institutionName, institutionName, "Your institution");

            if (el.institutionInitial) {
                el.institutionInitial.textContent =
                    getInitials(institutionName, "I");
            }

        } catch (error) {
            console.warn("[Foundev] Admin details:", error.message);
        }
    }

    /* =====================================================
       PROJECT CARD AND SELECTION TOOLBAR
    ===================================================== */

    function createSelectionToolbar() {
        if ($("#foundev-selection-toolbar")) return;

        const resultsBar = $(".projects-results-bar");

        if (!resultsBar) {
            console.error("Projects results bar not found.");
            return;
        }

        const toolbar = document.createElement("section");

        toolbar.id = "foundev-selection-toolbar";

        toolbar.style.cssText = `
            display:none;
            align-items:center;
            justify-content:space-between;
            flex-wrap:wrap;
            gap:16px;
            padding:18px 22px;
            margin:16px 0;
            background:#fffaf6;
            border:1px solid #ead6ca;
            border-radius:12px;
        `;

        toolbar.innerHTML = `
            <div>
                <strong style="font-size:13px;color:#29231f;">
                    <span id="foundev-selected-count">0</span>
                    projects selected
                </strong>

                <p id="foundev-selection-note"
                   style="margin:6px 0 0;color:#82786f;font-size:12px;">
                    Select at least 15 projects for partner pricing.
                </p>
            </div>

            <div style="
                display:flex;
                align-items:center;
                gap:14px;
                flex-wrap:wrap;
            ">
                <div style="text-align:right;">
                    <small id="foundev-total-label"
                           style="display:block;color:#82786f;">
                        Estimated total
                    </small>

                    <strong id="foundev-selection-total"
                            style="font-family:Georgia,serif;font-size:23px;">
                        —
                    </strong>
                </div>

                <button type="button"
                        id="foundev-clear-selection"
                        class="projects-button projects-button-secondary">
                    Clear
                </button>

                <button type="button"
                        id="foundev-proceed-selection"
                        class="projects-button projects-button-primary"
                        disabled>
                    Proceed to payment →
                </button>
            </div>
        `;

        resultsBar.insertAdjacentElement("afterend", toolbar);

        $("#foundev-clear-selection").addEventListener(
            "click",
            clearSelection
        );

        $("#foundev-proceed-selection").addEventListener(
            "click",
            startBulkCheckout
        );
    }

    function updateSelectionToolbar() {
        const toolbar = $("#foundev-selection-toolbar");

        if (!toolbar) return;

        const count = state.selectedIds.size;
        const eligible = count >= MIN_PARTNER_PROJECTS;

        toolbar.style.display = count ? "flex" : "none";

        setText($("#foundev-selected-count"), count);

        setText(
            $("#foundev-selection-note"),
            eligible
                ? "You qualify for partner institution pricing."
                : `Select ${MIN_PARTNER_PROJECTS - count} more project(s) to unlock partner pricing.`
        );

        setText(
            $("#foundev-total-label"),
            eligible
                ? "Estimated partner institution total"
                : "Estimated 3-student total"
        );

        const total = getSelectionTotal();

        setText(
            $("#foundev-selection-total"),
            total === null ? "Price unavailable" : formatPrice(total)
        );

        const proceed = $("#foundev-proceed-selection");

        if (proceed) {
            proceed.disabled = !eligible || total === null;
            proceed.title = eligible
                ? "Continue to partner institution checkout"
                : `Select at least ${MIN_PARTNER_PROJECTS} projects`;
        }

        renderProjects();
        updateOpenProjectPricing();
    }

    function clearSelection() {
        state.selectedIds.clear();

        updateSelectionToolbar();
    }

    function toggleSelection(projectId, checked) {
    const id = String(projectId);

    const project = state.projects.find(
        item => String(item.id) === id
    );

    if (project?.isPurchased) {
        state.selectedIds.delete(id);
        updateSelectionToolbar();
        return;
    }

    if (checked) {
        state.selectedIds.add(id);
    } else {
        state.selectedIds.delete(id);
    }

    updateSelectionToolbar();
}

    function projectCard(project) {
        const purchased = project.isPurchased === true;

const selected = !purchased &&
    state.selectedIds.has(String(project.id));

const selectionControl = purchased
    ? `
        <span style="
            color:#287443;
            background:#e9f5ec;
            padding:6px 10px;
            border-radius:20px;
            font-size:11px;
            font-weight:700;
        ">
            ✓ Purchased
        </span>
    `
    : `
        <label style="
            display:flex;
            align-items:center;
            gap:7px;
            font-size:11px;
            cursor:pointer;
        ">
            <input
                type="checkbox"
                data-select-project="${escapeHTML(project.id)}"
                ${selected ? "checked" : ""}
                aria-label="Select ${escapeHTML(project.title)}"
                style="accent-color:#ad583e;width:16px;height:16px;"
            >
            Select
        </label>
    `;

        const tags = project.technologies
            .slice(0, 4)
            .map(item => `
                <span class="project-tech-tag">
                    ${escapeHTML(item)}
                </span>
            `)
            .join("");

        const featured = project.featured
            ? `<span class="project-featured-label">Featured</span>`
            : "";

        const price = project.teamPrice === null
            ? "Price unavailable"
            : formatPrice(project.teamPrice, project.currency);

        return `
            <article class="project-card ${selected ? "is-selected" : ""}"
                     data-project-card="${escapeHTML(project.id)}"
                     style="${selected
                        ? "border-color:#ad583e;box-shadow:0 0 0 2px rgba(173,88,62,.08);"
                        : ""}">

                <div class="project-card-header">

                    ${selectionControl}

                    <span class="project-card-category">
                        ${escapeHTML(project.category)}
                    </span>

                    ${featured}
                </div>

                <div class="project-card-body">

                    <h3 class="project-card-title">
                        ${escapeHTML(project.title)}
                    </h3>

                    <p class="project-card-description">
                        ${escapeHTML(project.description)}
                    </p>

                    <div class="project-card-meta">
                        <span class="project-card-meta-item">
                            ◷ ${project.validityMonths} months access
                        </span>
                    </div>

                    <div class="project-card-technologies">
                        ${tags}
                    </div>

                    <div class="project-card-footer">

                        <div class="project-card-price-wrap">

                            <span class="project-card-price-label">
                                3-student project price
                            </span>

                            <strong class="project-card-price">
                                ${escapeHTML(price)}
                            </strong>

                            <span class="project-card-price-period">
                                ${project.validityMonths}-month validity
                            </span>

                        </div>

                        <button
    type="button"
    class="project-card-action"
    data-open-project="${escapeHTML(project.id)}"
    ${purchased ? "disabled" : ""}
    ${purchased ? 'aria-label="This project has already been purchased"' : ""}>
    ${purchased ? "Already purchased ✓" : "View details →"}
</button>

                    </div>
                </div>
            </article>
        `;
    }

    function renderProjects() {
        if (!el.grid) return;

        el.grid.innerHTML = state.filtered
            .map(projectCard)
            .join("");

        el.grid.setAttribute("aria-busy", "false");

        setText(el.total, state.projects.length);

        setText(
            el.resultsCount,
            `${state.filtered.length} ${state.filtered.length === 1 ? "project" : "projects"} found`
        );

        setHidden(el.loading, true);
        setHidden(el.error, true);
        setHidden(el.empty, state.filtered.length !== 0);

        if (!state.filtered.length) {
            const hasProjects = state.projects.length > 0;

            setText(
                el.emptyTitle,
                hasProjects ? "No matching projects" : "No projects available"
            );

            setText(
                el.emptyDescription,
                hasProjects
                    ? "Try another search or category."
                    : "There are no published projects in your catalogue."
            );
        }
    }

    /* =====================================================
       FILTERING
    ===================================================== */

    function applyFilters() {
        const query = String(el.search?.value || "")
            .trim()
            .toLowerCase();

        const category = el.category?.value || "all";
        const sort = el.sort?.value || "featured";

        let results = state.projects.filter(project => {
            const categoryMatch =
                category === "all" ||
                project.categorySlug === category;

            const searchText = [
                project.title,
                project.description,
                project.category,
                ...project.technologies,
                ...project.features
            ].join(" ").toLowerCase();

            return categoryMatch &&
                (!query || searchText.includes(query));
        });

        switch (sort) {
            case "price-low":
                results.sort((a, b) =>
                    (a.teamPrice ?? Infinity) -
                    (b.teamPrice ?? Infinity)
                );
                break;

            case "price-high":
                results.sort((a, b) =>
                    (b.teamPrice ?? -Infinity) -
                    (a.teamPrice ?? -Infinity)
                );
                break;

            case "name-asc":
                results.sort((a, b) =>
                    a.title.localeCompare(b.title)
                );
                break;

            case "name-desc":
                results.sort((a, b) =>
                    b.title.localeCompare(a.title)
                );
                break;

            default:
                results.sort((a, b) =>
                    Number(b.featured) - Number(a.featured)
                );
        }

        state.filtered = results;

        renderProjects();

        if (el.clearFilters) {
            el.clearFilters.hidden = !(
                query ||
                category !== "all" ||
                sort !== "featured"
            );
        }
    }

    function clearFilters() {
        if (el.search) el.search.value = "";
        if (el.category) el.category.value = "all";
        if (el.sort) el.sort.value = "featured";

        applyFilters();
    }

    /* =====================================================
       LOAD CATALOGUE
    ===================================================== */

   async function loadProjects() {
    if (state.loadController) {
        state.loadController.abort();
    }

    const controller = new AbortController();
    state.loadController = controller;

    const timeout = setTimeout(() => {
        controller.abort();
    }, 20000);

    setConnectionStatus("Connecting", "connecting");

    setHidden(el.loading, false);
    setHidden(el.error, true);
    setHidden(el.empty, true);

    if (el.grid) {
        el.grid.innerHTML = "";
        el.grid.setAttribute("aria-busy", "true");
    }

    setText(el.resultsCount, "Loading available projects...");

    if (el.refresh) el.refresh.disabled = true;
    if (el.retry) el.retry.disabled = true;

    try {
        const response = await apiRequest(API.catalogue, {
            signal: controller.signal
        });

        console.log("[Foundev] Catalogue response:", response);

        const rows = extractProjects(response);

        state.projects = rows
            .map(normalizeProject)
            .filter(project =>
                project.id &&
                project.id !== "undefined" &&
                project.title !== "Untitled project"
            );

        const validIds = new Set(
            state.projects.map(project => String(project.id))
        );

        state.selectedIds.forEach(id => {
            if (!validIds.has(String(id))) {
                state.selectedIds.delete(id);
            }
        });

        applyFilters();

        updateSelectionToolbar();

        setConnectionStatus("Connected", "success");

        console.log(
            "[Foundev] Projects loaded:",
            state.projects.length
        );

    } catch (error) {
        if (state.loadController !== controller) {
            return;
        }

        console.error("[Foundev] Catalogue loading error:", error);

        setHidden(el.loading, true);
        setHidden(el.empty, true);
        setHidden(el.error, false);

        setText(
            el.errorMessage,
            error.name === "AbortError"
                ? "The catalogue request timed out. Please check your connection and try again."
                : error.message || "Unable to load projects."
        );

        setText(el.resultsCount, "Unable to load projects");

        setConnectionStatus("Connection failed", "error");

    } finally {
        clearTimeout(timeout);

        if (state.loadController === controller) {
            state.loadController = null;

            setHidden(el.loading, true);

            if (el.grid) {
                el.grid.setAttribute("aria-busy", "false");
            }

            if (el.refresh) el.refresh.disabled = false;
            if (el.retry) el.retry.disabled = false;
        }
    }
}

    /* =====================================================
       PROJECT DETAILS
    ===================================================== */

    function fillList(container, items, className = "") {
        if (!container) return;

        container.replaceChildren();

        items.forEach(value => {
            const item = document.createElement(
                container.tagName === "UL" ? "li" : "span"
            );

            if (className) item.className = className;

            item.textContent = value;

            container.appendChild(item);
        });
    }

    function createPartnerPricePanel() {
        if ($("#foundev-partner-price-panel")) return;

        const panel = document.createElement("div");

        panel.id = "foundev-partner-price-panel";

        panel.style.cssText = `
            padding:14px 16px;
            margin:14px 0;
            border:1px solid #e8d2c4;
            border-radius:9px;
            background:#fff8f3;
        `;

        panel.innerHTML = `
            <div style="
                font-size:11px;
                font-weight:700;
                color:#a9573d;
                letter-spacing:.06em;
                margin-bottom:7px;
            ">
                PARTNER INSTITUTION PRICE
            </div>

            <strong id="foundev-partner-price"
                    style="
                        display:block;
                        font-family:Georgia,serif;
                        font-size:23px;
                        color:#29231f;
                    ">
                —
            </strong>

            <p id="foundev-partner-price-note"
               style="
                    margin:6px 0 0;
                    color:#82786f;
                    font-size:11px;
                    line-height:1.6;
               ">
                Select at least 15 projects to unlock this price.
            </p>
        `;

        const form = el.checkoutForm;

        if (form) {
            const section = $(".projects-form-section", form);

            if (section) {
                section.insertAdjacentElement("beforebegin", panel);
            } else {
                form.prepend(panel);
            }
        }
    }

    function updateOpenProjectPricing() {
        const project = state.selectedProject;

        if (!project) return;

        const teamSize = state.teamSize;
        const eligible = hasPartnerEligibility() &&
            state.selectedIds.has(String(project.id));

        const normalPrice = getTierPrice(project, teamSize);
        const partnerPrice = getPartnerPrice(project);

        setText(
            el.selectedTierPrice,
            eligible && partnerPrice !== null
                ? formatPrice(partnerPrice, project.currency)
                : formatPrice(normalPrice, project.currency)
        );

        setText(
            el.selectedTierDescription,
            eligible && partnerPrice !== null
                ? "Partner institution price · 15+ selected projects"
                : `${teamSize}-student project pricing`
        );

        createPartnerPricePanel();

        setText(
            $("#foundev-partner-price"),
            partnerPrice === null
                ? "Not configured"
                : formatPrice(partnerPrice, project.currency)
        );

        setText(
            $("#foundev-partner-price-note"),
            eligible
                ? "You qualify for partner pricing. The final amount will be verified by Foundev's server."
                : `Select at least ${MIN_PARTNER_PROJECTS} projects, including this project, to unlock the partner price.`
        );

        const panel = $("#foundev-partner-price-panel");

        if (panel) {
            panel.style.borderColor = eligible
                ? "#ad583e"
                : "#e8d2c4";
        }

        if (el.pricingStatus) {
            el.pricingStatus.textContent = eligible
                ? "Partner institution pricing is available for this selection."
                : `Partner institution pricing becomes available when you select ${MIN_PARTNER_PROJECTS} or more projects.`;
        }
    }

    function openProject(projectId) {
    const project = state.projects.find(
        item => item.id === String(projectId)
    );

    if (!project) return;

    if (project.isPurchased) {
        alert("This project has already been purchased by your institution.");
        return;
    }

        state.selectedProject = project;
        state.checkoutMode = "single";
setCheckoutModeUI(false);
        setText(el.detailTitle, project.title);
        setText(el.detailSubtitle, project.category);
        setText(el.detailDescription, project.description);
        setText(el.checkoutProjectName, project.title);

        if (el.projectId) {
            el.projectId.value = project.id;
        }

        fillList(
            el.detailTechnologies,
            project.technologies.length
                ? project.technologies
                : ["Not specified"],
            "project-tech-tag"
        );

        fillList(
            el.detailFeatures,
            project.features.length
                ? project.features
                : [
                    "Practical project experience",
                    "Technology-focused learning",
                    `${project.validityMonths}-month access`
                ]
        );

        resetCheckoutForm();

        const defaultRadio = $("#team-size-3");

        if (defaultRadio) {
            defaultRadio.checked = true;

            defaultRadio.dispatchEvent(
                new Event("change", { bubbles: true })
            );
        }

        state.teamSize = 3;

        updateOpenProjectPricing();

        showCheckoutMessage("", "");

        setText(
            el.checkoutButton?.querySelector("span"),
            "Verify students & continue"
        );

        openDialog(el.detailsDialog);
    }

    /* =====================================================
       FORM RESET AND STUDENT INPUTS
    ===================================================== */

    function resetCheckoutForm() {
        if (el.teamName) el.teamName.value = "";
        if (el.customerPhone) el.customerPhone.value = "";

        [
            "#student-username-1",
            "#student-username-2",
            "#student-username-3"
        ].forEach(selector => {
            const input = $(selector);

            if (input) input.value = "";
        });

        if (el.confirmTeamProfiles) {
            el.confirmTeamProfiles.checked = false;
        }

        if (el.teamProfileSection) {
            el.teamProfileSection.hidden = true;
        }

        $("#foundev-bulk-checkout-summary")?.remove();
        invalidateStudentProfiles();
    }

    function getTeamSize() {
        const selected = $('input[name="team_size"]:checked');

        return selected
            ? Number(selected.value)
            : DEFAULT_TEAM_SIZE;
    }

    function getStudentUsernames() {
        const size = getTeamSize();

        return Array.from({ length: size }, (_, index) => {
            const input = $(`#student-username-${index + 1}`);

            return String(input?.value || "").trim();
        });
    }

    function showCheckoutMessage(message, type = "error") {
        if (!el.checkoutMessage) return;

        el.checkoutMessage.textContent = message;
        el.checkoutMessage.className = "projects-form-message";

        if (message && type) {
            el.checkoutMessage.classList.add(type);
        }

        el.checkoutMessage.hidden = !message;
    }
/* =====================================================
   STUDENT PROFILE VERIFICATION
===================================================== */

function invalidateStudentProfiles() {
    state.profilesVerified = false;
    state.verifiedStudents = [];

    if (el.confirmTeamProfiles) {
        el.confirmTeamProfiles.checked = false;
    }

    if (el.teamProfileSection) {
        el.teamProfileSection.hidden = true;
    }

    if (el.teamProfileContainer) {
        el.teamProfileContainer.replaceChildren();
    }

    if (el.checkoutButton) {
        const label = el.checkoutButton.querySelector("span");

        if (label && state.checkoutMode === "single") {
            label.textContent = "Verify students & continue";
        }
    }
}

function renderStudentProfiles(students) {
    if (!el.teamProfileContainer || !el.teamProfileSection) {
        throw new Error("Student profile display section is missing.");
    }

    el.teamProfileContainer.replaceChildren();

    students.forEach((student, index) => {
        const card = document.createElement("article");

        card.className = "verified-student-card";

        const heading = document.createElement("div");
        heading.className = "verified-student-card-heading";

        const number = document.createElement("span");
        number.className = "verified-student-number";
        number.textContent = `MEMBER ${index + 1}`;

        const status = document.createElement("span");
        status.className = "verified-student-status";
        status.textContent = "Verified";

        heading.append(number, status);

        const name = document.createElement("h4");
        name.textContent = student.full_name || "Student";

        const username = document.createElement("p");
        username.className = "verified-student-username";
        username.textContent = `@${student.username}`;

        const details = document.createElement("dl");
        details.className = "verified-student-details";

        const addDetail = (label, value) => {
            if (
                value === null ||
                value === undefined ||
                String(value).trim() === ""
            ) {
                return;
            }

            const wrapper = document.createElement("div");

            const dt = document.createElement("dt");
            dt.textContent = label;

            const dd = document.createElement("dd");
            dd.textContent = String(value);

            wrapper.append(dt, dd);
            details.appendChild(wrapper);
        };

        addDetail("Email", student.email);
        addDetail("Roll number", student.roll_number);
        addDetail("Course", student.course);
        addDetail("Academic year", student.academic_year);

        card.append(
            heading,
            name,
            username,
            details
        );

        el.teamProfileContainer.appendChild(card);
    });

    // Display the verified student profiles.
el.teamProfileSection.hidden = false;

// Remove the inline display:none !important
// applied by setCheckoutModeUI().
el.teamProfileSection.style.removeProperty("display");
}

async function verifyAndDisplayStudents() {
    const teamSize = getTeamSize();
    const usernames = getStudentUsernames();

    if (![1, 2, 3].includes(teamSize)) {
        throw new Error("Select a valid team size.");
    }

    if (
        usernames.length !== teamSize ||
        usernames.some(username => !username)
    ) {
        throw new Error(
            `Enter all ${teamSize} student usernames.`
        );
    }

    const normalized = usernames.map(username =>
        username.toLowerCase()
    );

    if (new Set(normalized).size !== normalized.length) {
        throw new Error(
            "Each team member must have a different username."
        );
    }

    const response = await apiRequest(API.verifyStudents, {
        method: "POST",
        body: JSON.stringify({
            student_usernames: usernames
        })
    });

    const data = unwrap(response);
    const students = data.students;

    if (!Array.isArray(students) || students.length !== teamSize) {
        throw new Error(
            "The server did not return all student profiles."
        );
    }

    state.verifiedStudents = students;
    state.profilesVerified = true;

    renderStudentProfiles(students);

    if (el.confirmTeamProfiles) {
        el.confirmTeamProfiles.checked = false;
    }

    if (el.checkoutButton) {
        const label = el.checkoutButton.querySelector("span");

        if (label) {
            label.textContent = "Continue to payment";
        }
    }

    el.teamProfileSection.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}
    function validateCheckout() {
    const phone = String(
        el.customerPhone?.value || ""
    ).trim();

    if (!/^[0-9]{10,15}$/.test(phone)) {
        throw new Error(
            "Enter a valid institution contact number using 10–15 digits."
        );
    }

    // Institution bulk purchase:
    // No team name, team size or student usernames required.
    if (state.checkoutMode === "bulk") {
        return {
            purchaser_type: "institution",
            customer_phone: phone,
            team_size: null,
            team_name: null,
            student_usernames: []
        };
    }

    // Existing individual purchase validation.
    const teamSize = getTeamSize();

    const teamName = String(
        el.teamName?.value || ""
    ).trim();

    const usernames = getStudentUsernames();

    if (![1, 2, 3].includes(teamSize)) {
        throw new Error("Please select a valid team size.");
    }

    if (teamSize > 1 && teamName.length < 2) {
        throw new Error("Enter a valid team name.");
    }

    if (teamName.length > 150) {
        throw new Error(
            "Team name cannot exceed 150 characters."
        );
    }

    if (
        usernames.length !== teamSize ||
        usernames.some(item => !item)
    ) {
        throw new Error(
            `Enter all ${teamSize} student usernames.`
        );
    }

    const normalized = usernames.map(item =>
        item.toLowerCase()
    );

    if (new Set(normalized).size !== normalized.length) {
        throw new Error(
            "Each student must have a different username."
        );
    }

    if (!state.profilesVerified) {
    throw new Error("Please verify the student profiles first.");
}

if (
    !el.confirmTeamProfiles ||
    !el.confirmTeamProfiles.checked
) {
    throw new Error(
        "Please confirm the displayed student profiles before payment."
    );
}

    return {
        purchaser_type: "student",
        team_size: teamSize,
        team_name: teamName,
        student_usernames: usernames,
        customer_phone: phone
    };
}
    /* =====================================================
       SEPARATE BULK CHECKOUT DIALOG

       IMPORTANT:
       The existing form is moved into this dialog.
       It is NOT a project-details dialog.
    ===================================================== */

    function createBulkCheckoutDialog() {
        if (state.bulkDialog) return;

        const dialog = document.createElement("dialog");

        dialog.id = "foundev-bulk-checkout-dialog";
        dialog.className = "projects-dialog";

        dialog.setAttribute(
            "aria-labelledby",
            "foundev-bulk-checkout-title"
        );

        dialog.innerHTML = `
            <div class="projects-dialog-header">
                <div>
                    <p class="section-kicker">PARTNER CHECKOUT</p>

                    <h2 id="foundev-bulk-checkout-title">
    Institution project purchase
</h2>

<p>
    Review your selected projects and complete your institution's purchase.
    Student assignments can be managed after purchase.
</p>
                </div>

                <button type="button"
                        class="projects-dialog-close"
                        id="foundev-close-bulk-checkout"
                        aria-label="Close checkout">
                    ×
                </button>
            </div>

            <div class="projects-dialog-body">

                <div id="foundev-bulk-checkout-summary"
                     style="
                        padding:15px;
                        margin-bottom:18px;
                        background:#fff8f3;
                        border:1px solid #ead6ca;
                        border-radius:9px;
                     ">
                    <strong id="foundev-bulk-count"></strong>

                    <div id="foundev-bulk-total"
                         style="
                            margin-top:7px;
                            font-family:Georgia,serif;
                            font-size:25px;
                         ">
                    </div>

                    <p id="foundev-bulk-price-note"
                       style="font-size:11px;color:#82786f;margin-bottom:0;">
                    </p>
                </div>

                <div id="foundev-bulk-form-host"></div>

            </div>
        `;

        document.body.appendChild(dialog);

        state.bulkDialog = dialog;

        $("#foundev-close-bulk-checkout").addEventListener(
            "click",
            closeBulkCheckout
        );

        dialog.addEventListener("cancel", () => {
            restoreCheckoutForm();
        });

        dialog.addEventListener("click", event => {
            if (event.target === dialog) {
                closeBulkCheckout();
            }
        });
    }

    function moveCheckoutFormToBulkDialog() {
        if (!el.checkoutForm || !state.bulkDialog) return;

        if (!state.formOrigin) {
            state.formOrigin = {
                parent: el.checkoutForm.parentElement,
                next: el.checkoutForm.nextSibling
            };
        }

        const host = $("#foundev-bulk-form-host", state.bulkDialog);

        host.appendChild(el.checkoutForm);
    }

    function restoreCheckoutForm() {
        if (!el.checkoutForm || !state.formOrigin) return;

        const { parent, next } = state.formOrigin;

        if (!parent) return;

        if (next && next.parentNode === parent) {
            parent.insertBefore(el.checkoutForm, next);
        } else {
            parent.appendChild(el.checkoutForm);
        }

        state.formOrigin = null;
    }

    function updateBulkDialogSummary() {
        const selected = getSelectedProjects();
        const total = getSelectionTotal();

        setText(
            $("#foundev-bulk-count"),
            `${selected.length} projects selected`
        );

        setText(
            $("#foundev-bulk-total"),
            total === null ? "Price unavailable" : formatPrice(total)
        );

        setText(
            $("#foundev-bulk-price-note"),
            `Partner institution pricing applied to ${selected.length} selected projects. Final pricing is verified by Foundev's server.`
        );
    }

    function startBulkCheckout() {
    if (!hasPartnerEligibility()) {
        alert(
            `Select at least ${MIN_PARTNER_PROJECTS} projects to use partner pricing.`
        );
        return;
    }

    if (getSelectionTotal() === null) {
        alert(
            "One or more selected projects have no configured partner price."
        );
        return;
    }

    const selected = getSelectedProjects();

    if (!selected.length) return;

    state.selectedProject = selected[0];
    state.checkoutMode = "bulk";

    if (el.projectId) {
        el.projectId.value = selected[0].id;
    }

    setText(
        el.checkoutProjectName,
        `${selected.length} selected projects`
    );

    resetCheckoutForm();

    createBulkCheckoutDialog();

    moveCheckoutFormToBulkDialog();

    // Apply bulk mode after the form has moved.
    setCheckoutModeUI(true);

    updateBulkDialogSummary();

    showCheckoutMessage("", "");

    openDialog(state.bulkDialog);
}
function setCheckoutModeUI(isBulk) {
    const hideElement = (element, hide) => {
        if (!element) return;

        element.hidden = hide;

        if (hide) {
            element.style.setProperty(
                "display",
                "none",
                "important"
            );
        } else {
            element.style.removeProperty("display");
        }
    };

    // Team size section
    const teamSizeSection = $("#member-count-heading")
        ?.closest(".projects-form-section");

    // Student username section
    const studentSection = $("#student-members-heading")
        ?.closest(".projects-form-section");

    // Team name field
    const teamNameField = $("#team-name-field");

    // Individual project's partner-price panel
    const partnerPricePanel = $("#foundev-partner-price-panel");

    hideElement(teamSizeSection, isBulk);
    hideElement(studentSection, isBulk);
    hideElement(teamNameField, isBulk);
    hideElement(partnerPricePanel, isBulk);

    // Team name is not required for institution purchases.
    if (el.teamName) {
        el.teamName.required = !isBulk;
    }

    // Hide student profile confirmation.
    hideElement(el.teamProfileSection, true);

    // Update checkout button.
    const buttonLabel =
        el.checkoutButton?.querySelector("span");

    if (buttonLabel) {
        buttonLabel.textContent = isBulk
            ? "Continue to institution payment"
            : "Verify students & continue";
    }
}
    function closeBulkCheckout() {
    closeDialog(state.bulkDialog);

    restoreCheckoutForm();

    state.checkoutMode = "single";

    setCheckoutModeUI(false);
}

    /* =====================================================
       CASHFREE
    ===================================================== */

    function loadCashfreeSDK() {
        if (window.Cashfree) {
            return Promise.resolve(window.Cashfree);
        }

        return new Promise((resolve, reject) => {
            let script = $('script[data-foundev-cashfree="true"]');

            if (!script) {
                script = document.createElement("script");

                script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
                script.async = true;
                script.dataset.foundevCashfree = "true";

                document.head.appendChild(script);
            }

            script.addEventListener("load", () => {
                if (window.Cashfree) {
                    resolve(window.Cashfree);
                } else {
                    reject(new Error("Cashfree SDK failed to initialize."));
                }
            }, { once: true });

            script.addEventListener("error", () => {
                reject(new Error("Unable to load Cashfree checkout."));
            }, { once: true });

            if (window.Cashfree) resolve(window.Cashfree);
        });
    }

    /* =====================================================
       CREATE ORDER AND REDIRECT TO CASHFREE

       One selected project:
         project_ids: [123]

       15+ selected projects:
         project_ids: [123, 124, 125, ...]

       The server MUST calculate all prices again.
    ===================================================== */

    
async function beginCheckout(event) {
    event.preventDefault();

    if (state.paymentBusy) return;

    const isBulk = state.checkoutMode === "bulk";

    /*
     * First submission:
     * Verify and display student profiles.
     *
     * Second submission:
     * Continue only after administrator confirmation.
     */

    if (!isBulk && !state.profilesVerified) {
        try {
            if (el.checkoutButton) {
                el.checkoutButton.disabled = true;

                const span = el.checkoutButton.querySelector("span");

                if (span) {
                    span.textContent = "Verifying students...";
                }
            }

            showCheckoutMessage("", "");

            await verifyAndDisplayStudents();

            showCheckoutMessage(
                "Student profiles verified. Review them and confirm before continuing.",
                "success"
            );

        } catch (error) {
            showCheckoutMessage(error.message);

        } finally {
            if (el.checkoutButton) {
                el.checkoutButton.disabled = false;

                if (!state.profilesVerified) {
                    const span = el.checkoutButton.querySelector("span");

                    if (span) {
                        span.textContent = "Verify students & continue";
                    }
                }
            }
        }

        return;
    }

    let formData;

    try {
        formData = validateCheckout();
    } catch (error) {
        showCheckoutMessage(error.message);
        return;
    }

    

    let projectIds = [];

    if (isBulk) {
        if (!hasPartnerEligibility()) {
            showCheckoutMessage(
                `At least ${MIN_PARTNER_PROJECTS} projects are required for partner checkout.`
            );
            return;
        }

        projectIds = getSelectedProjects().map(project =>
            Number(project.id)
        );
    } else {
        const project = state.selectedProject;

        if (!project) {
            showCheckoutMessage("Select a project first.");
            return;
        }

        projectIds = [Number(project.id)];
    }

    if (
        !projectIds.length ||
        projectIds.some(id => !Number.isInteger(id) || id <= 0)
    ) {
        showCheckoutMessage("The selected project list is invalid.");
        return;
    }

    // Separate payloads for single and bulk purchases.
    const endpoint = isBulk
        ? API.createBulkOrder
        : API.createSingleOrder;

    const payload = isBulk
        ? {
            purchaser_type: "institution",
            project_ids: projectIds,
            pricing_mode: "partner_institution",
            customer_phone: formData.customer_phone,
            minimum_partner_quantity: MIN_PARTNER_PROJECTS
        }
        : {
            purchaser_type: "student",
            project_id: projectIds[0],
            team_size: formData.team_size,
            team_name: formData.team_name,
            student_usernames: formData.student_usernames,
            customer_phone: formData.customer_phone
        };

    state.paymentBusy = true;
    state.paymentMode = isBulk ? "bulk" : "single";

    if (el.checkoutButton) {
        el.checkoutButton.disabled = true;

        const span = el.checkoutButton.querySelector("span");

        if (span) {
            span.textContent = "Creating secure payment...";
        }
    }

    showCheckoutMessage("", "");

    try {
        const response = await apiRequest(endpoint, {
            method: "POST",
            body: JSON.stringify(payload)
        });

        const data = unwrap(response);
        const order = data.order || {};

        const orderReference = first(
            order.reference,
            order.order_id,
            data.order_reference,
            data.order_id
        );

        const paymentSessionId = first(
            order.payment_session_id,
            data.payment_session_id
        );

        const mode = String(first(
            data.cashfree_environment,
            data.cashfree_mode,
            "sandbox"
        )).toLowerCase();

        if (!orderReference || !paymentSessionId) {
            throw new Error(
                "The order API did not return a Cashfree order reference and payment session."
            );
        }

        state.paymentOrderId = String(orderReference);

        const Cashfree = await loadCashfreeSDK();

        state.cashfree = Cashfree({
            mode: mode === "production"
                ? "production"
                : "sandbox"
        });

        closeDialog(el.detailsDialog);
        closeBulkCheckout();

        await state.cashfree.checkout({
            paymentSessionId: String(paymentSessionId),
            redirectTarget: "_self"
        });

    } catch (error) {
        console.error("[Foundev] Checkout error:", error);

        showCheckoutMessage(
            error.message || "Unable to start payment."
        );

    } finally {
        state.paymentBusy = false;

        if (el.checkoutButton) {
            el.checkoutButton.disabled = false;

            const span = el.checkoutButton.querySelector("span");

            if (span) {
                span.textContent = isBulk
                    ? "Continue to institution payment"
                    : "Verify students & continue";
            }
        }
    }
}

    /* =====================================================
       PAYMENT VERIFICATION
    ===================================================== */

    
async function verifyPayment(orderReference) {
    const endpoint = state.paymentMode === "bulk"
        ? API.verifyBulkPayment
        : API.verifySinglePayment;

    const response = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify({
            order_reference: orderReference
        })
    });

    const data = unwrap(response);

    if (data.paid === true) {
        return {
            paid: true,
            final: true,
            data
        };
    }

    const status = String(first(
        data.payment_status,
        data.order_status,
        data.status,
        ""
    )).toUpperCase();

    if ([
        "FAILED",
        "CANCELLED",
        "EXPIRED",
        "USER_DROPPED"
    ].includes(status)) {
        return {
            paid: false,
            final: true,
            status,
            data
        };
    }

    return {
        paid: false,
        final: false,
        status: status || "PENDING",
        data
    };
}


    function showPaymentDialog() {
        setText(el.paymentTitle, "Checking your payment");

        setText(
            el.paymentDescription,
            "Please wait while we verify your transaction."
        );

        setText(
            el.paymentMessage,
            "Verifying payment with Foundev's server..."
        );

        if (el.paymentResult) {
            el.paymentResult.className = "projects-payment-result";
        }

        setHidden(el.paymentRetry, true);
        setHidden(el.paymentDone, false);

        openDialog(el.paymentDialog);
    }

    async function checkPayment(orderReference = state.paymentOrderId) {
        if (!orderReference || state.paymentBusy) return;

        state.paymentBusy = true;

        showPaymentDialog();

        if (el.paymentRetry) {
            el.paymentRetry.disabled = true;
            el.paymentRetry.textContent = "Checking...";
        }

        try {
            const result = await verifyPayment(orderReference);

            if (result.paid) {
                setText(el.paymentTitle, "Payment confirmed");

                setText(
                    el.paymentDescription,
                    "Your payment has been verified successfully."
                );

                setText(
                    el.paymentMessage,
                    result.data.access_expires_at
                        ? `Your project access is active until ${result.data.access_expires_at}.`
                        : "Your project purchase has been confirmed."
                );

                el.paymentResult?.classList.add("payment-success");

                setConnectionStatus("Payment verified", "success");

                setHidden(el.paymentRetry, true);

                state.selectedIds.clear();

                await loadProjects();

                updateSelectionToolbar();

            } else if (result.final) {
                setText(el.paymentTitle, "Payment not completed");

                setText(
                    el.paymentDescription,
                    "Cashfree did not confirm a successful payment."
                );

                setText(
                    el.paymentMessage,
                    `Payment status: ${result.status}. If money was deducted, contact support before attempting another payment.`
                );

                el.paymentResult?.classList.add("payment-error");

                setHidden(el.paymentRetry, true);

            } else {
                setText(el.paymentTitle, "Payment pending");

                setText(
                    el.paymentDescription,
                    "The transaction has not yet been confirmed."
                );

                setText(
                    el.paymentMessage,
                    "Please wait and check again. Do not create another order while this payment is pending."
                );

                setHidden(el.paymentRetry, false);
            }

        } catch (error) {
            console.error("[Foundev] Payment verification:", error);

            setText(el.paymentTitle, "Unable to verify payment");
            setText(el.paymentDescription, "Verification could not be completed.");
            setText(el.paymentMessage, error.message);

            setHidden(el.paymentRetry, false);

        } finally {
            state.paymentBusy = false;

            if (el.paymentRetry) {
                el.paymentRetry.disabled = false;
                el.paymentRetry.textContent = "Check payment again";
            }
        }
    }

    function handlePaymentReturn() {
        const params = new URLSearchParams(window.location.search);
const paymentType = params.get("payment_type");

state.paymentMode = paymentType === "bulk"
    ? "bulk"
    : "single";
        const orderId = first(
            params.get("order_id"),
            params.get("orderId")
        );

        if (!orderId) return;

        state.paymentOrderId = orderId;

        checkPayment(orderId);

        params.delete("order_id");
        params.delete("orderId");
        params.delete("payment");
params.delete("payment_type");
        const query = params.toString();

        const cleanURL =
            window.location.pathname +
            (query ? `?${query}` : "") +
            window.location.hash;

        window.history.replaceState(
            {},
            document.title,
            cleanURL
        );
    }

    /* =====================================================
       DIALOG HELPERS
    ===================================================== */

    function openDialog(dialog) {
        if (!dialog) return;

        if (typeof dialog.showModal === "function" && !dialog.open) {
            dialog.showModal();
        }
    }

    function closeDialog(dialog) {
        if (dialog?.open) {
            dialog.close();
        }
    }

    /* =====================================================
       EVENTS
    ===================================================== */

    function bindEvents() {
        el.search?.addEventListener("input", applyFilters);
        el.category?.addEventListener("change", applyFilters);
        el.sort?.addEventListener("change", applyFilters);

        el.refresh?.addEventListener("click", loadProjects);
        el.retry?.addEventListener("click", loadProjects);
        el.clearFilters?.addEventListener("click", clearFilters);

        // Project card buttons.
        el.grid?.addEventListener("click", event => {
            const button = event.target.closest("[data-open-project]");

            if (!button) return;

            openProject(button.dataset.openProject);
        });

        // Project checkboxes.
        el.grid?.addEventListener("change", event => {
            const checkbox = event.target.closest("[data-select-project]");

            if (!checkbox) return;

            toggleSelection(
                checkbox.dataset.selectProject,
                checkbox.checked
            );
        });

       // Team size updates.
$$('input[name="team_size"]').forEach(radio => {
    radio.addEventListener("change", () => {

        invalidateStudentProfiles();

        state.teamSize = getTeamSize();

        updateOpenProjectPricing();
        updateSelectionToolbar();
    });
});
// Changing any username invalidates previously verified profiles.
[
    "#student-username-1",
    "#student-username-2",
    "#student-username-3"
].forEach(selector => {
    const input = $(selector);

    input?.addEventListener("input", invalidateStudentProfiles);
});

// Confirmation is required before continuing.
el.confirmTeamProfiles?.addEventListener("change", () => {

    if (!el.confirmTeamProfiles.checked) {
        return;
    }

    if (!state.profilesVerified) {
        el.confirmTeamProfiles.checked = false;

        showCheckoutMessage(
            "Please verify the student profiles first."
        );
    }
});

        document.addEventListener(
            "foundev:team-size-changed",
            event => {
                state.teamSize = Number(
                    event.detail?.teamSize || DEFAULT_TEAM_SIZE
                );

                updateOpenProjectPricing();
                updateSelectionToolbar();
            }
        );

        // Form submission.
        el.checkoutForm?.addEventListener("submit", beginCheckout);

        // Existing dialog close buttons.
        $$("[data-close-project-dialog]").forEach(button => {
            button.addEventListener("click", () => {
                closeDialog(el.detailsDialog);
            });
        });

        $$("[data-close-payment-dialog]").forEach(button => {
            button.addEventListener("click", () => {
                closeDialog(el.paymentDialog);
            });
        });

        el.paymentRetry?.addEventListener("click", () => {
            checkPayment();
        });

        el.paymentDone?.addEventListener("click", () => {
            closeDialog(el.paymentDialog);
        });

        // Account menu.
        const accountButton = $("#account-menu-button");
        const accountMenu = $("#account-menu");

        accountButton?.addEventListener("click", () => {
            if (!accountMenu) return;

            accountMenu.hidden = !accountMenu.hidden;

            accountButton.setAttribute(
                "aria-expanded",
                String(!accountMenu.hidden)
            );
        });

        document.addEventListener("click", event => {
            if (!accountButton || !accountMenu) return;

            if (
                !accountButton.contains(event.target) &&
                !accountMenu.contains(event.target)
            ) {
                accountMenu.hidden = true;

                accountButton.setAttribute(
                    "aria-expanded",
                    "false"
                );
            }
        });

        // Search shortcut.
        document.addEventListener("keydown", event => {
            const target = event.target;

            const typing = target instanceof HTMLElement && (
                target.isContentEditable ||
                ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
            );

            if (event.key === "/" && !typing) {
                event.preventDefault();
                el.search?.focus();
            }
        });
    }

    /* =====================================================
       INITIALIZE
    ===================================================== */

    async function init() {
        setText(el.currentYear, new Date().getFullYear());

        if (el.dashboardDate) {
            el.dashboardDate.textContent =
                new Intl.DateTimeFormat("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }).format(new Date());
        }

        createSelectionToolbar();
        bindEvents();

        await Promise.allSettled([
            loadAdminDetails(),
            loadProjects()
        ]);

        handlePaymentReturn();
    }

   window.FoundevProjects = {
    refresh: loadProjects,
    clearFilters,
    clearSelection,

    getProjects: () => [...state.projects],
    getSelectedProjects,
    getSelectedIds: () => [...state.selectedIds],

    // Correct function name, with compatibility alias.
    getSelectionTotal,
    getSelectedTotal: getSelectionTotal,

    getTeamSize,
    startBulkCheckout
};
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, {
            once: true
        });
    } else {
        init();
    }

})();
