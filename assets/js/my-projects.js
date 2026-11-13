
/* =========================================================
   FOUNDEV — MY PROJECTS
   File: student/assets/js/my-projects.js

   Features:
   - Load purchased projects from student API
   - Responsive project cards
   - Student profile from projects API
   - Search, filtering and sorting
   - Pagination
   - Loading, error and empty states
   - Mobile sidebar
   - Student logout

   Card-click behaviour intentionally not implemented yet.
========================================================= */

(() => {
    "use strict";

    /* ---------------------------------------------------------
       CONFIGURATION
    --------------------------------------------------------- */

    const CONFIG = {
        projectsApi: "../api/student/projects.php",
        logoutApi: "../api/student/logout.php",
        pageSize: 6
    };

    const state = {
        projects: [],
        filteredProjects: [],
        currentPage: 1,
        search: "",
        status: "all",
        sort: "updated",
        loading: false
    };

    /* ---------------------------------------------------------
       ELEMENTS
    --------------------------------------------------------- */

    const $ = (selector, root = document) =>
        root.querySelector(selector);

    const elements = {
        studentName: $("#student-name"),
        studentInstitution: $("#student-institution"),
        studentAvatar: $("#student-avatar"),

        mobileMenu: $("#mobile-menu"),
        sidebar: $("#sidebar"),
        sidebarOverlay: $("#sidebar-overlay"),
        logout: $("#student-logout"),

        workspaceSearch: $("#workspace-search"),
        workspaceSearchInput: $("#workspace-search-input"),

        totalProjects: $("#totalProjects"),
        inProgressProjects: $("#inProgressProjects"),
        completedProjects: $("#completedProjects"),
        pendingProjects: $("#pendingProjects"),

        projectSearch: $("#projectSearch"),
        statusFilter: $("#projectStatusFilter"),
        sortFilter: $("#projectSort"),
        clearFilters: $("#clearProjectFilters"),

        resultCount: $("#projectResultCount"),
        projectsList: $("#projectsList"),
        projectsLoading: $("#projectsLoading"),
        projectsError: $("#projectsError"),
        projectsErrorText: $("#projectsErrorText"),
        retryButton: $("#retryProjectsButton"),
        projectsEmpty: $("#projectsEmpty"),
        emptyTitle: $("#projectsEmptyTitle"),
        emptyText: $("#projectsEmptyText"),
        exploreLink: $("#exploreProjectsLink"),

        pagination: $("#projectsPagination"),
        previousPage: $("#previousProjectPage"),
        nextPage: $("#nextProjectPage"),
        pageInfo: $("#projectPageInfo"),

        modal: $("#projectDetailsModal"),
        modalTitle: $("#projectModalTitle"),
        modalContent: $("#projectModalContent"),
        closeModal: $("#closeProjectModal"),
        closeModalFooter: $("#closeProjectModalFooter")
    };

    /* ---------------------------------------------------------
       STYLES

       These styles make the cards work without requiring
       changes to the existing CSS file.
    --------------------------------------------------------- */

    function injectCardStyles() {
        if ($("#foundev-my-projects-card-styles")) {
            return;
        }

        const style = document.createElement("style");
        style.id = "foundev-my-projects-card-styles";

        style.textContent = `
            .project-list {
                display: grid !important;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 22px;
                width: 100%;
                margin-top: 22px;
            }

            .project-card {
                position: relative;
                display: flex;
                flex-direction: column;
                min-width: 0;
                padding: 25px;
                background: #fffdf9;
                border: 1px solid #e9dfd2;
                border-radius: 18px;
                box-shadow: 0 5px 18px rgba(52, 37, 22, 0.035);
                transition: border-color .2s ease,
                            box-shadow .2s ease,
                            transform .2s ease;
                animation: foundevCardIn .35s ease both;
            }

            .project-card:hover {
                border-color: #c9a98b;
                box-shadow: 0 12px 28px rgba(52, 37, 22, 0.075);
                transform: translateY(-3px);
            }

            .project-card-top {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 22px;
            }

            .project-purchased-badge {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                padding: 7px 11px;
                color: #287443;
                background: #eaf5ed;
                border-radius: 30px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: .02em;
            }

            .project-purchase-type {
                color: #8a7764;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: .07em;
            }

            .project-card h3 {
                margin: 0 0 10px;
                color: #2d2118;
                font-family: 'Manrope', sans-serif;
                font-size: 20px;
                font-weight: 700;
                line-height: 1.4;
                overflow-wrap: anywhere;
            }

            .project-card-description {
                display: -webkit-box;
                margin: 0 0 20px;
                color: #82766b;
                font-size: 13px;
                line-height: 1.7;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }

            .project-card-category {
                display: inline-flex;
                align-self: flex-start;
                margin-bottom: 20px;
                padding: 7px 11px;
                color: #a65032;
                background: #f9eee7;
                border: 1px solid #f0ded1;
                border-radius: 7px;
                font-size: 11px;
                font-weight: 700;
            }

            .project-card-divider {
                height: 1px;
                width: 100%;
                margin: 0 0 18px;
                background: #eee6dc;
            }

            .project-card-meta {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 16px 12px;
                margin-bottom: 20px;
            }

            .project-card-meta-item {
                min-width: 0;
            }

            .project-card-meta-label {
                display: block;
                margin-bottom: 5px;
                color: #a09284;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: .07em;
                text-transform: uppercase;
            }

            .project-card-meta-value {
                display: block;
                color: #49392c;
                font-size: 12px;
                font-weight: 600;
                overflow-wrap: anywhere;
            }

            .project-card-technologies {
                display: flex;
                flex-wrap: wrap;
                gap: 7px;
                margin-top: auto;
            }

            .project-tech-tag {
                padding: 6px 10px;
                color: #725b46;
                background: #f5f0e9;
                border: 1px solid #ebe1d5;
                border-radius: 6px;
                font-size: 11px;
                font-weight: 500;
            }

            .project-card-expiry {
                display: flex;
                align-items: center;
                gap: 7px;
                margin-top: 20px;
                padding-top: 15px;
                border-top: 1px solid #eee6dc;
                color: #756653;
                font-size: 12px;
            }

            .project-card-expiry strong {
                color: #49392c;
            }

            .project-card-expiry.expired {
                color: #b54736;
            }

            .project-card-expiry.expired strong {
                color: #b54736;
            }

            .project-card-empty-tech {
                color: #a09284;
                font-size: 12px;
            }

            @keyframes foundevCardIn {
                from {
                    opacity: 0;
                    transform: translateY(9px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @media (max-width: 900px) {
                .project-list {
                    grid-template-columns: 1fr;
                }
            }

            @media (max-width: 560px) {
                .project-card {
                    padding: 19px;
                }

                .project-card h3 {
                    font-size: 18px;
                }

                .project-card-meta {
                    grid-template-columns: 1fr 1fr;
                }
            }
        `;

        document.head.appendChild(style);
    }

    /* ---------------------------------------------------------
       HELPERS
    --------------------------------------------------------- */

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => {
            const entities = {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            };

            return entities[character];
        });
    }

    function firstValue(object, keys, fallback = "") {
        if (!object || typeof object !== "object") {
            return fallback;
        }

        for (const key of keys) {
            const value = object[key];

            if (
                value !== undefined &&
                value !== null &&
                String(value).trim() !== ""
            ) {
                return value;
            }
        }

        return fallback;
    }

    function setText(element, value) {
        if (element) {
            element.textContent = String(value ?? "");
        }
    }

    function setVisible(element, visible) {
        if (element) {
            element.hidden = !visible;
        }
    }

    function formatDate(value) {
        if (!value) {
            return "Not specified";
        }

        const date = new Date(
            String(value).replace(" ", "T")
        );

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return new Intl.DateTimeFormat("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric"
        }).format(date);
    }

    function formatInitials(name) {
        return String(name || "Student")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(word => word[0].toUpperCase())
            .join("");
    }

    function normalizeStatus(value) {
        const status = String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[_-]+/g, " ");

        if (["active", "approved", "ongoing", "in progress"].includes(status)) {
            return "active";
        }

        if (["completed", "complete", "finished"].includes(status)) {
            return "completed";
        }

        if (["pending", "requested", "pending approval"].includes(status)) {
            return "pending";
        }

        if (["paused", "on hold", "onhold"].includes(status)) {
            return "paused";
        }

        return status || "active";
    }

    function getProjectId(project) {
        return String(
            firstValue(project, ["id", "project_id"], "")
        );
    }

    function getProjectTitle(project) {
        return String(
            firstValue(
                project,
                ["title", "project_title", "name"],
                "Untitled project"
            )
        );
    }

    function getProjectDescription(project) {
        return String(
            firstValue(
                project,
                ["description", "project_description", "summary"],
                "No description has been provided."
            )
        );
    }

    function getProjectCategory(project) {
        return String(
            firstValue(
                project,
                ["category", "domain", "project_type"],
                "General"
            )
        );
    }

    function getProjectTechnologies(project) {
        let technologies = project.technologies ?? [];

        if (typeof technologies === "string") {
            try {
                const decoded = JSON.parse(technologies);

                technologies = Array.isArray(decoded)
                    ? decoded
                    : technologies.split(/[,|]/);
            } catch {
                technologies = technologies.split(/[,|]/);
            }
        }

        if (!Array.isArray(technologies)) {
            return [];
        }

        return technologies
            .map(item => {
                if (typeof item === "object" && item !== null) {
                    return String(
                        firstValue(item, ["name", "title"], "")
                    );
                }

                return String(item);
            })
            .map(item => item.trim())
            .filter(Boolean);
    }

    function getPurchaseDate(project) {
        return firstValue(
            project,
            ["purchased_at", "created_at"],
            ""
        );
    }

    function getExpiryDate(project) {
        return firstValue(
            project,
            ["access_expires_at"],
            ""
        );
    }

    function getProjectStatus(project) {
        return normalizeStatus(project.status);
    }

    function getPurchaseType(project) {
        return String(project.purchase_type || "single").toLowerCase();
    }

    function getTeamSize(project) {
        const value = Number(
            project.member_count || project.team_size || 0
        );

        return value > 0 ? value : null;
    }

    function isExpired(project) {
        const expiry = getExpiryDate(project);

        if (!expiry) {
            return false;
        }

        const date = new Date(String(expiry).replace(" ", "T"));

        return !Number.isNaN(date.getTime()) && date <= new Date();
    }

    function getProjectTimestamp(project) {
        const value = firstValue(
            project,
            ["purchased_at", "created_at"],
            ""
        );

        if (!value) {
            return 0;
        }

        const timestamp = new Date(
            String(value).replace(" ", "T")
        ).getTime();

        return Number.isNaN(timestamp) ? 0 : timestamp;
    }

    /* ---------------------------------------------------------
       API REQUEST
    --------------------------------------------------------- */

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.headers || {})
            }
        });

        const text = await response.text();

        let payload;

        try {
            payload = JSON.parse(text);
        } catch {
            throw new Error(
                "The server returned an invalid response. Check the PHP API."
            );
        }

        if (response.status === 401 || response.status === 403) {
            throw new Error(
                payload.message || "Your student session has expired. Please sign in again."
            );
        }

        if (!response.ok || payload.success === false) {
            throw new Error(
                payload.message || `Request failed (${response.status}).`
            );
        }

        return payload;
    }

    /* ---------------------------------------------------------
       STUDENT PROFILE
    --------------------------------------------------------- */

    function updateStudentProfile(student) {
        if (!student) {
            return;
        }

        const name = firstValue(
            student,
            ["name", "full_name", "student_name"],
            "Student"
        );

        setText(elements.studentName, name);
        setText(elements.studentAvatar, formatInitials(name));

        if (elements.studentInstitution) {
            setText(
                elements.studentInstitution,
                student.institution_name || "Student account"
            );
        }
    }

    /* ---------------------------------------------------------
       SUMMARY COUNTS
    --------------------------------------------------------- */

    function updateSummary() {
        const projects = state.projects;

        const inProgress = projects.filter(project =>
            ["active", "in progress"].includes(getProjectStatus(project))
        ).length;

        const completed = projects.filter(project =>
            getProjectStatus(project) === "completed"
        ).length;

        const pending = projects.filter(project =>
            getProjectStatus(project) === "pending"
        ).length;

        setText(elements.totalProjects, projects.length);
        setText(elements.inProgressProjects, inProgress);
        setText(elements.completedProjects, completed);
        setText(elements.pendingProjects, pending);
    }

    /* ---------------------------------------------------------
       PROJECT CARD
    --------------------------------------------------------- */

    function renderProjectCard(project, index) {
        const title = getProjectTitle(project);
        const description = getProjectDescription(project);
        const category = getProjectCategory(project);
        const technologies = getProjectTechnologies(project);

        const purchaseType = getPurchaseType(project);
        const purchaseDate = getPurchaseDate(project);
        const expiryDate = getExpiryDate(project);
        const teamSize = getTeamSize(project);

        const expired = isExpired(project);

        const purchaseLabel = purchaseType === "bulk"
            ? "Institution purchase"
            : "Individual purchase";

        const technologiesHtml = technologies.length
            ? technologies.map(technology => `
                <span class="project-tech-tag">
                    ${escapeHtml(technology)}
                </span>
            `).join("")
            : `
                <span class="project-card-empty-tech">
                    No technologies specified
                </span>
            `;

        const teamLabel = teamSize
            ? `${teamSize} student${teamSize === 1 ? "" : "s"}`
            : "Not specified";

        const expiryHtml = expiryDate
            ? `
                <div class="project-card-expiry ${expired ? "expired" : ""}">
                    <span aria-hidden="true">${expired ? "!" : "◷"}</span>
                    <span>
                        ${expired ? "Access expired:" : "Access valid until:"}
                        <strong>${escapeHtml(formatDate(expiryDate))}</strong>
                    </span>
                </div>
            `
            : `
                <div class="project-card-expiry">
                    <span aria-hidden="true">◷</span>
                    <span>Access expiry: <strong>Not specified</strong></span>
                </div>
            `;

        return `
            <article
                class="project-card"
                data-project-id="${escapeHtml(getProjectId(project))}"
                style="animation-delay:${Math.min(index * 50, 250)}ms"
            >
                <div class="project-card-top">
                    <span class="project-purchased-badge">
                        ✓ Purchased
                    </span>

                    <span class="project-purchase-type">
                        ${escapeHtml(purchaseType)}
                    </span>
                </div>

                <h3>${escapeHtml(title)}</h3>

                <p class="project-card-description">
                    ${escapeHtml(description)}
                </p>

                <span class="project-card-category">
                    ${escapeHtml(category)}
                </span>

                <div class="project-card-divider"></div>

                <div class="project-card-meta">
                    <div class="project-card-meta-item">
                        <span class="project-card-meta-label">
                            Purchase type
                        </span>
                        <span class="project-card-meta-value">
                            ${escapeHtml(purchaseLabel)}
                        </span>
                    </div>

                    <div class="project-card-meta-item">
                        <span class="project-card-meta-label">
                            Team size
                        </span>
                        <span class="project-card-meta-value">
                            ${escapeHtml(teamLabel)}
                        </span>
                    </div>

                    <div class="project-card-meta-item">
                        <span class="project-card-meta-label">
                            Purchased on
                        </span>
                        <span class="project-card-meta-value">
                            ${escapeHtml(formatDate(purchaseDate))}
                        </span>
                    </div>

                    <div class="project-card-meta-item">
                        <span class="project-card-meta-label">
                            Project ID
                        </span>
                        <span class="project-card-meta-value">
                            #${escapeHtml(getProjectId(project))}
                        </span>
                    </div>
                </div>

                <div class="project-card-technologies">
                    ${technologiesHtml}
                </div>

                ${expiryHtml}
            </article>
        `;
    }

    /* ---------------------------------------------------------
       FILTERS AND SORTING
    --------------------------------------------------------- */

    function matchesSearch(project) {
        if (!state.search) {
            return true;
        }

        const searchable = [
            getProjectTitle(project),
            getProjectDescription(project),
            getProjectCategory(project),
            getProjectTechnologies(project).join(" "),
            project.purchase_type || "",
            project.team_name || ""
        ].join(" ").toLowerCase();

        return searchable.includes(state.search);
    }

    function matchesStatus(project) {
        if (state.status === "all") {
            return true;
        }

        const status = getProjectStatus(project);

        if (state.status === "active") {
            return status === "active" || status === "in progress";
        }

        return status === state.status;
    }

    function sortProjects(projects) {
        const sorted = [...projects];

        switch (state.sort) {
            case "newest":
                sorted.sort((a, b) =>
                    getProjectTimestamp(b) - getProjectTimestamp(a)
                );
                break;

            case "oldest":
                sorted.sort((a, b) =>
                    getProjectTimestamp(a) - getProjectTimestamp(b)
                );
                break;

            case "name":
                sorted.sort((a, b) =>
                    getProjectTitle(a).localeCompare(getProjectTitle(b))
                );
                break;

            case "updated":
            default:
                sorted.sort((a, b) =>
                    getProjectTimestamp(b) - getProjectTimestamp(a)
                );
                break;
        }

        return sorted;
    }

    function applyFilters() {
        state.filteredProjects = sortProjects(
            state.projects.filter(project =>
                matchesSearch(project) && matchesStatus(project)
            )
        );

        state.currentPage = 1;

        const hasFilters = Boolean(state.search) || state.status !== "all";
        setVisible(elements.clearFilters, hasFilters);

        renderProjects();
    }

    function clearFilters() {
        state.search = "";
        state.status = "all";
        state.sort = "updated";

        if (elements.projectSearch) {
            elements.projectSearch.value = "";
        }

        if (elements.workspaceSearchInput) {
            elements.workspaceSearchInput.value = "";
        }

        if (elements.statusFilter) {
            elements.statusFilter.value = "all";
        }

        if (elements.sortFilter) {
            elements.sortFilter.value = "updated";
        }

        applyFilters();
    }

    /* ---------------------------------------------------------
       STATES
    --------------------------------------------------------- */

    function setLoading(loading) {
        state.loading = loading;

        setVisible(elements.projectsLoading, loading);

        if (loading) {
            setVisible(elements.projectsError, false);
            setVisible(elements.projectsEmpty, false);
            setVisible(elements.projectsList, false);
            setVisible(elements.pagination, false);
        }
    }

    function showError(message) {
        setVisible(elements.projectsLoading, false);
        setVisible(elements.projectsEmpty, false);
        setVisible(elements.projectsList, false);
        setVisible(elements.pagination, false);
        setVisible(elements.projectsError, true);

        setText(
            elements.projectsErrorText,
            message || "Unable to load your projects. Please try again."
        );

        setText(elements.resultCount, "Unable to load projects");
    }

    function showEmptyState() {
        setVisible(elements.projectsLoading, false);
        setVisible(elements.projectsError, false);
        setVisible(elements.projectsList, false);
        setVisible(elements.pagination, false);
        setVisible(elements.projectsEmpty, true);

        const hasFilters = Boolean(state.search) || state.status !== "all";

        if (hasFilters) {
            setText(elements.emptyTitle, "No matching projects");

            setText(
                elements.emptyText,
                "Try changing your search or filters to find your projects."
            );

            if (elements.exploreLink) {
                elements.exploreLink.textContent = "Clear filters";
                elements.exploreLink.href = "#projects-heading";
                elements.exploreLink.dataset.action = "clear-filters";
            }
        } else {
            setText(elements.emptyTitle, "Your next project starts here");

            setText(
                elements.emptyText,
                "You do not have any purchased projects yet. Explore available projects to get started."
            );

            if (elements.exploreLink) {
                elements.exploreLink.textContent = "Explore projects";
                elements.exploreLink.href = "explore-projects.html";
                elements.exploreLink.dataset.action = "explore-projects";
            }
        }
    }

    /* ---------------------------------------------------------
       PAGINATION
    --------------------------------------------------------- */

    function renderPagination(totalPages) {
        const total = state.filteredProjects.length;

        if (!elements.pagination) {
            return;
        }

        if (total === 0 || totalPages <= 1) {
            setVisible(elements.pagination, false);
            return;
        }

        setVisible(elements.pagination, true);

        if (elements.previousPage) {
            elements.previousPage.disabled = state.currentPage <= 1;
        }

        if (elements.nextPage) {
            elements.nextPage.disabled = state.currentPage >= totalPages;
        }

        setText(
            elements.pageInfo,
            `Page ${state.currentPage} of ${totalPages}`
        );
    }

    /* ---------------------------------------------------------
       RENDER PROJECTS
    --------------------------------------------------------- */

    function renderProjects() {
        setVisible(elements.projectsLoading, false);
        setVisible(elements.projectsError, false);

        const total = state.filteredProjects.length;

        setText(
            elements.resultCount,
            `${total} project${total === 1 ? "" : "s"}`
        );

        if (total === 0) {
            if (elements.projectsList) {
                elements.projectsList.innerHTML = "";
            }

            showEmptyState();
            return;
        }

        setVisible(elements.projectsEmpty, false);
        setVisible(elements.projectsList, true);

        const totalPages = Math.ceil(total / CONFIG.pageSize);

        state.currentPage = Math.min(
            Math.max(1, state.currentPage),
            totalPages
        );

        const start = (state.currentPage - 1) * CONFIG.pageSize;

        const pageProjects = state.filteredProjects.slice(
            start,
            start + CONFIG.pageSize
        );

        elements.projectsList.innerHTML = pageProjects
            .map((project, index) => renderProjectCard(project, index))
            .join("");

        renderPagination(totalPages);
    }

    /* ---------------------------------------------------------
       LOAD PROJECTS
    --------------------------------------------------------- */

    async function loadProjects() {
        setLoading(true);

        try {
            const payload = await apiRequest(CONFIG.projectsApi);

            if (!Array.isArray(payload.projects)) {
                throw new Error(
                    "The API did not return a valid projects array."
                );
            }

            state.projects = payload.projects.filter(project =>
                project && typeof project === "object"
            );

            // Update the profile using the student object
            // returned by the same working projects API.
            updateStudentProfile(payload.student);

            updateSummary();
            applyFilters();

            setLoading(false);

            console.log(
                `Foundev: loaded ${state.projects.length} purchased projects.`
            );

        } catch (error) {
            console.error("Foundev projects API error:", error);
            showError(error.message);
        }
    }

    /* ---------------------------------------------------------
       MOBILE SIDEBAR
    --------------------------------------------------------- */

    function openSidebar() {
        elements.sidebar?.classList.add("active", "open");

        if (elements.sidebarOverlay) {
            elements.sidebarOverlay.classList.add("active", "visible");
            elements.sidebarOverlay.hidden = false;
        }

        elements.mobileMenu?.setAttribute("aria-expanded", "true");
        document.body.classList.add("sidebar-open");
    }

    function closeSidebar() {
        elements.sidebar?.classList.remove("active", "open");

        if (elements.sidebarOverlay) {
            elements.sidebarOverlay.classList.remove("active", "visible");
            elements.sidebarOverlay.hidden = true;
        }

        elements.mobileMenu?.setAttribute("aria-expanded", "false");
        document.body.classList.remove("sidebar-open");
    }

    function toggleSidebar() {
        const open = elements.sidebar?.classList.contains("active");

        if (open) {
            closeSidebar();
        } else {
            openSidebar();
        }
    }

    /* ---------------------------------------------------------
       LOGOUT
    --------------------------------------------------------- */

    async function logout() {
        if (!elements.logout || elements.logout.dataset.loggingOut === "true") {
            return;
        }

        elements.logout.dataset.loggingOut = "true";

        try {
            await apiRequest(CONFIG.logoutApi, {
                method: "POST"
            });

            window.location.href = "../../index.html";

        } catch (error) {
            console.error("Foundev logout error:", error);

            delete elements.logout.dataset.loggingOut;

            alert(
                error.message ||
                "Unable to log out right now. Please try again."
            );
        }
    }

    /* ---------------------------------------------------------
       EVENT LISTENERS
    --------------------------------------------------------- */

    function handleSearch(value) {
        state.search = String(value || "").trim().toLowerCase();

        if (elements.projectSearch) {
            elements.projectSearch.value = value;
        }

        if (elements.workspaceSearchInput) {
            elements.workspaceSearchInput.value = value;
        }

        applyFilters();
    }

    function bindEvents() {
        elements.projectSearch?.addEventListener("input", event => {
            handleSearch(event.target.value);
        });

        elements.workspaceSearchInput?.addEventListener("input", event => {
            handleSearch(event.target.value);
        });

        elements.workspaceSearch?.addEventListener("submit", event => {
            event.preventDefault();

            handleSearch(elements.workspaceSearchInput?.value || "");

            elements.projectSearch?.focus();
        });

        elements.statusFilter?.addEventListener("change", event => {
            state.status = event.target.value || "all";
            applyFilters();
        });

        elements.sortFilter?.addEventListener("change", event => {
            state.sort = event.target.value || "updated";
            applyFilters();
        });

        elements.clearFilters?.addEventListener("click", clearFilters);

        elements.retryButton?.addEventListener("click", loadProjects);

        elements.previousPage?.addEventListener("click", () => {
            if (state.currentPage > 1) {
                state.currentPage--;
                renderProjects();
            }
        });

        elements.nextPage?.addEventListener("click", () => {
            const totalPages = Math.ceil(
                state.filteredProjects.length / CONFIG.pageSize
            );

            if (state.currentPage < totalPages) {
                state.currentPage++;
                renderProjects();
            }
        });

        elements.mobileMenu?.addEventListener("click", toggleSidebar);
        elements.sidebarOverlay?.addEventListener("click", closeSidebar);

        elements.sidebar?.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", closeSidebar);
        });

        elements.logout?.addEventListener("click", logout);

        elements.projectsEmpty?.addEventListener("click", event => {
            const action = event.target.closest("[data-action]");

            if (!action) {
                return;
            }

            if (action.dataset.action === "clear-filters") {
                event.preventDefault();
                clearFilters();
            }
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                closeSidebar();
            }

            if (
                event.key === "/" &&
                !["INPUT", "TEXTAREA", "SELECT"].includes(
                    document.activeElement?.tagName
                )
            ) {
                event.preventDefault();
                elements.projectSearch?.focus();
            }
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > 900) {
                closeSidebar();
            }
        });
    }

    /* ---------------------------------------------------------
       INITIALIZE
    --------------------------------------------------------- */

    function initialize() {
        injectCardStyles();
        bindEvents();

        if (elements.sidebarOverlay) {
            elements.sidebarOverlay.hidden = true;
        }

        elements.mobileMenu?.setAttribute("aria-expanded", "false");

        loadProjects();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, {
            once: true
        });
    } else {
        initialize();
    }

})();
