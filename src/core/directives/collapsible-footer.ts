// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Directive, ElementRef, Input, OnDestroy, OnInit } from '@angular/core';
import { ScrollDetail } from '@ionic/core';
import { IonContent } from '@ionic/angular';
import { CoreUtils } from '@services/utils/utils';
import { CoreMath } from '@singletons/math';
import { CoreComponentsRegistry } from '@singletons/components-registry';
import { CoreFormatTextDirective } from './format-text';
import { CoreEventObserver } from '@singletons/events';
import { CoreLoadingComponent } from '@components/loading/loading';
import { CoreDomUtils } from '@services/utils/dom';
import { CoreCancellablePromise } from '@classes/cancellable-promise';

/**
 * Directive to make an element fixed at the bottom collapsible when scrolling.
 *
 * Example usage:
 *
 * <div collapsible-footer>
 */
@Directive({
    selector: '[collapsible-footer]',
})
export class CoreCollapsibleFooterDirective implements OnInit, OnDestroy {

    @Input() appearOnBottom = false;

    protected element: HTMLElement;
    protected initialHeight = 48;
    protected finalHeight = 0;
    protected initialPaddingBottom = '0px';
    protected previousTop = 0;
    protected previousHeight = 0;
    protected content?: HTMLIonContentElement | null;
    protected loadingChangedListener?: CoreEventObserver;
    protected contentScrollListener?: EventListener;
    protected endContentScrollListener?: EventListener;
    protected resizeListener?: CoreEventObserver;
    protected domPromise?: CoreCancellablePromise<void>;

    constructor(el: ElementRef, protected ionContent: IonContent) {
        this.element = el.nativeElement;
        this.element.setAttribute('slot', 'fixed'); // Just in case somebody forgets to add it.
    }

    /**
     * @inheritdoc
     */
    async ngOnInit(): Promise<void> {
        // Only if not present or explicitly falsy it will be false.
        this.appearOnBottom = !CoreUtils.isFalseOrZero(this.appearOnBottom);
        this.domPromise = CoreDomUtils.waitToBeInDOM(this.element);

        await this.domPromise;
        await this.waitLoadingsDone();
        await this.waitFormatTextsRendered();

        this.content = this.element.closest('ion-content');

        await this.calculateHeight();

        this.listenScrollEvents();
    }

    /**
     * Calculate the height of the footer.
     */
    protected async calculateHeight(): Promise<void> {
        this.element.classList.remove('is-active');
        await CoreUtils.nextTick();

        // Set a minimum height value.
        this.initialHeight = this.element.getBoundingClientRect().height || this.initialHeight;
        const moduleNav = this.element.querySelector('core-course-module-navigation');
        if (moduleNav) {
            this.element.classList.add('has-module-nav');
            this.finalHeight = this.initialHeight - (moduleNav.getBoundingClientRect().height);
        }

        this.previousHeight = this.initialHeight;

        this.content?.style.setProperty('--core-collapsible-footer-max-height', this.initialHeight + 'px');
        this.element.classList.add('is-active');

        this.setBarHeight(this.initialHeight);
    }

    /**
     * Setup scroll event listener.
     */
    protected async listenScrollEvents(): Promise<void> {
        if (!this.content || this.content?.classList.contains('has-collapsible-footer')) {
            return;
        }

        this.content.classList.add('has-collapsible-footer');

        // Move element to the nearest ion-content if it's not the parent.
        if (this.element.parentElement?.nodeName != 'ION-CONTENT') {
            this.content.appendChild(this.element);
        }

        // Set a padding to not overlap elements.
        this.initialPaddingBottom = this.content.style.getPropertyValue('--padding-bottom') || this.initialPaddingBottom;
        this.content.style.setProperty(
            '--padding-bottom',
            `calc(${this.initialPaddingBottom} + var(--core-collapsible-footer-max-height, 0px))`,
        );

        const scroll = await this.content.getScrollElement();
        this.content.scrollEvents = true;

        this.content.addEventListener('ionScroll', this.contentScrollListener = (e: CustomEvent<ScrollDetail>): void => {
            if (!this.content) {
                return;
            }

            this.onScroll(e.detail, scroll);
        });

        this.content.addEventListener('ionScrollEnd', this.endContentScrollListener = (): void => {
            if (!this.content) {
                return;
            }

            const height = this.previousHeight;
            const collapsed = height <= this.finalHeight;
            const expanded = height >= this.initialHeight;

            if (!collapsed && !expanded) {
                // Finish opening or closing the bar.
                const newHeight = (height - this.finalHeight) < (this.initialHeight - this.finalHeight) / 2
                    ? this.finalHeight
                    : this.initialHeight;

                this.setBarHeight(newHeight);
            }
        });

        this.resizeListener = CoreDomUtils.onWindowResize(() => {
            this.calculateHeight();
        }, 50);
    }

    /**
     * Wait until all <core-format-text> children inside the element are done rendering.
     */
    protected async waitFormatTextsRendered(): Promise<void> {
        await CoreComponentsRegistry.waitComponentsReady(this.element, 'core-format-text', CoreFormatTextDirective);
    }

    /**
     * On scroll function.
     *
     * @param scrollDetail Scroll detail object.
     * @param scrollElement Scroll element to calculate maxScroll.
     */
    protected onScroll(scrollDetail: ScrollDetail, scrollElement: HTMLElement): void {
        const maxScroll = scrollElement.scrollHeight - scrollElement.offsetHeight;
        if (scrollDetail.scrollTop <= 0 || (this.appearOnBottom && scrollDetail.scrollTop >= maxScroll)) {
            // Reset.
            this.setBarHeight(this.initialHeight);
        } else {
            let newHeight = this.previousHeight - (scrollDetail.scrollTop - this.previousTop);
            newHeight = CoreMath.clamp(newHeight, this.finalHeight, this.initialHeight);

            this.setBarHeight(newHeight);
        }
        this.previousTop = scrollDetail.scrollTop;
    }

    /**
     * Sets the bar height.
     *
     * @param height The new bar height.
     */
    protected setBarHeight(height: number): void {
        const collapsed = height <= this.finalHeight;
        const expanded = height >= this.initialHeight;
        this.element.classList.toggle('footer-collapsed', collapsed);
        this.element.classList.toggle('footer-expanded', expanded);
        this.content?.style.setProperty('--core-collapsible-footer-height', height + 'px');
        this.previousHeight = height;
    }

    /**
     * Wait until all <core-loading> children inside the page.
     *
     * @return Promise resolved when loadings are done.
     */
    protected async waitLoadingsDone(): Promise<void> {
        const scrollElement = await this.ionContent.getScrollElement();

        await Promise.all([
            await CoreComponentsRegistry.waitComponentsReady(scrollElement, 'core-loading', CoreLoadingComponent),
            await CoreComponentsRegistry.waitComponentsReady(this.element, 'core-loading', CoreLoadingComponent),
        ]);
    }

    /**
     * @inheritdoc
     */
    async ngOnDestroy(): Promise<void> {
        this.content?.style.setProperty('--padding-bottom', this.initialPaddingBottom);

        if (this.content && this.contentScrollListener) {
            this.content.removeEventListener('ionScroll', this.contentScrollListener);
        }
        if (this.content && this.endContentScrollListener) {
            this.content.removeEventListener('ionScrollEnd', this.endContentScrollListener);
        }

        this.resizeListener?.off();
        this.domPromise?.cancel();
    }

}
